import config from '../../config.json' with { type: 'json' };
import {
  buildRimLut,
  RIM_SAMPLE_SIZE,
  sampleRim,
  stripBand,
  VIDEO_MAX_WIDTH,
  type VideoGeometry,
  type VideoMode
} from '../../shared/video';

import { authHeaders } from './auth';
import { startStandaloneTicker } from './ticker';

// The geometry and the sampling maths live in shared/ so the server's NDI receiver reads
// the same pixels for the same settings; re-exported here because the capture panel and
// the calibration overlay are browser-side.
export {
  DEFAULT_VIDEO_GEOMETRY,
  rimScale,
  type VideoGeometry,
  type VideoMode
} from '../../shared/video';

// Where the strip this tab samples is sent so the server-side pattern can read it.
const ENDPOINT = '/api/video';

// 'camera' opens a capture device; 'screen' shares a window, tab or display, which is
// how a player or a VJ tool gets its output in here without a native integration.
export type VideoSource = 'camera' | 'screen';

// What the capture panel can be pointed at. 'ndi' is not a browser capture at all: the
// server joins the stream itself and does the sampling, so it never reaches the code
// below.
export type VideoInput = VideoSource | 'ndi';

export interface VideoCaptureHandle {
  stop: () => void;
}

interface VideoCaptureOptions {
  source: VideoSource;
  // Read every frame, so the mode can be switched without tearing the stream down.
  mode: () => VideoMode;
  // Owned by the caller so the stream can be shown while it is being sampled; the
  // element also has to be in the page, or browsers may stop decoding frames into it.
  video: HTMLVideoElement;
  // Read every frame, so dragging a calibration slider takes effect without a restart.
  geometry: () => VideoGeometry;
  // Called with the strip that was just sent, for a preview. The array is reused.
  onStrip: (width: number, rgb: Uint8Array) => void;
  // Called when the browser ends the capture on its own (e.g. "Stop sharing").
  onEnded: () => void;
}

async function openStream(source: VideoSource): Promise<MediaStream> {
  const video: MediaTrackConstraints = { frameRate: { ideal: 30 } };
  if (source === 'screen') return navigator.mediaDevices.getDisplayMedia({ video });

  // A square-ish request suits a fisheye lens and costs nothing in strip mode, where
  // the frame is flattened to a single row anyway.
  return navigator.mediaDevices.getUserMedia({
    video: { ...video, width: { ideal: 720 }, height: { ideal: 720 } }
  });
}

// Capture video in this tab, reduce every frame to a strip, and stream it to the server
// until the returned handle is stopped.
export async function startVideoCapture({
  source,
  mode,
  video,
  geometry,
  onStrip,
  onEnded
}: VideoCaptureOptions): Promise<VideoCaptureHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not allow video capture on this page');
  }

  const stream = await openStream(source);
  const [track] = stream.getVideoTracks();
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No video was shared.');
  }

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const canvas = document.createElement('canvas');
  // Without this hint the canvas stays on the GPU and every read stalls on a readback.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('This browser could not provide a 2D canvas to sample with');
  }

  const lights = Math.min(VIDEO_MAX_WIDTH, config.nLights);
  const strip = new Uint8Array(VIDEO_MAX_WIDTH * 3);
  let lut = buildRimLut(lights, geometry(), 1);
  let lutKey = '';
  let posting = false;

  // Resizing a canvas resets its context, so the filtering hints are re-applied here.
  const resize = (width: number, height: number) => {
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  };

  // Collapse a horizontal band of the frame to a single row. The browser's own downscale
  // box-filters whole columns, so the band averages down rather than picking one
  // arbitrary line.
  const takeStrip = (): number => {
    const width = Math.min(VIDEO_MAX_WIDTH, video.videoWidth);
    const { top, rows } = stripBand(geometry(), video.videoHeight);

    resize(width, 1);
    ctx.drawImage(video, 0, top, video.videoWidth, rows, 0, 0, width, 1);

    const { data } = ctx.getImageData(0, 0, width, 1);
    for (let i = 0; i < width; i++) {
      strip[i * 3] = data[i * 4];
      strip[i * 3 + 1] = data[i * 4 + 1];
      strip[i * 3 + 2] = data[i * 4 + 2];
    }
    return width;
  };

  // Average an annulus inside the image, one patch per light. The whole frame is
  // squashed into the square working buffer rather than centre-cropped, so nothing is
  // thrown away on a wide window; the sample positions undo that squash so the ring
  // stays a circle in the image whatever the source aspect ratio is.
  const takeRim = (): number => {
    resize(RIM_SAMPLE_SIZE, RIM_SAMPLE_SIZE);
    ctx.drawImage(video, 0, 0, RIM_SAMPLE_SIZE, RIM_SAMPLE_SIZE);

    const g = geometry();
    const aspect = video.videoWidth / video.videoHeight;
    const key = `${g.centerX}|${g.centerY}|${g.radius}|${g.ringWidth}|${g.rotation}|${aspect}`;
    if (key !== lutKey) {
      lut = buildRimLut(lights, g, aspect);
      lutKey = key;
    }

    const { data } = ctx.getImageData(0, 0, RIM_SAMPLE_SIZE, RIM_SAMPLE_SIZE);
    sampleRim(data, lut, lights, strip);
    return lights;
  };

  const post = (width: number) => {
    // Drop a frame rather than queue behind a slow request; the next one is 33ms away.
    if (posting) return;
    posting = true;

    const body = new Uint8Array(2 + width * 3);
    new DataView(body.buffer).setUint16(0, width, true);
    body.set(strip.subarray(0, width * 3), 2);

    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
      body
    })
      .catch(() => undefined)
      .finally(() => {
        posting = false;
      });
  };

  const stopTicker = await startStandaloneTicker(() => {
    // Nothing has been decoded yet, or the track dropped out mid-session.
    if (video.readyState < video.HAVE_CURRENT_DATA) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    const width = mode() === 'strip' ? takeStrip() : takeRim();
    if (width === 0) return;

    onStrip(width, strip);
    post(width);
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopTicker();
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  // The browser's own "stop sharing" control ends the track without going through us.
  track.addEventListener('ended', () => {
    stop();
    onEnded();
  });

  return { stop };
}
