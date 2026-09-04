import config from '../../config.json' with { type: 'json' };
import { VIDEO_MAX_WIDTH } from '../../shared/video';

import { authHeaders } from './auth';
import { startStandaloneTicker } from './ticker';

// Where the strip this tab samples is sent so the server-side pattern can read it.
const ENDPOINT = '/api/video';

// 'camera' opens a capture device; 'screen' shares a window, tab or display, which is
// how a player or a VJ tool gets its output in here without a native integration.
export type VideoSource = 'camera' | 'screen';

// 'strip' treats the feed as one row of colors, so a universe-wide, short video maps
// straight onto the lights. 'fisheye' samples a ring inside a circular image and throws
// it outwards, the way an ambient backlight follows the edges of a screen.
export type VideoMode = 'strip' | 'fisheye';

// Which part of the frame each mode reads, all as fractions so the numbers survive a
// change of resolution. `radius` is the ring's radius as a fraction of half the frame's
// shorter side — the ring stays a circle on a wide frame rather than following its edges
// as an ellipse — and `ringWidth` its thickness as a fraction of that; `rotation` is
// where light 0 reads from, as a fraction of a turn clockwise from the top; the strip
// band is a fraction of the frame height.
export interface VideoGeometry {
  centerX: number;
  centerY: number;
  radius: number;
  ringWidth: number;
  rotation: number;
  stripY: number;
  stripHeight: number;
}

export const DEFAULT_VIDEO_GEOMETRY: VideoGeometry = {
  centerX: 0.5,
  centerY: 0.5,
  radius: 1,
  // A zero-width ring by default: every light reads a single circle of pixels.
  ringWidth: 0,
  rotation: 0,
  stripY: 0.5,
  stripHeight: 0.025
};

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

// Working resolution for fisheye sampling. Every light averages a patch of the rim, so
// resolving the source any finer than this only makes the readback more expensive.
const SAMPLE_SIZE = 256;

// Samples averaged per light: a few steps along the rim and a few across its width.
const ARC_SAMPLES = 4;
const RADIAL_SAMPLES = 4;

// Averaging has to happen in linear light. Averaging sRGB values directly pulls any mix
// of a bright and a dark sample towards the dark one, which turns a lively rim muddy.
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

function encode(linear: number): number {
  const c =
    linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  const byte = Math.round(c * 255);
  return byte < 0 ? 0 : byte > 255 ? 255 : byte;
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

// The frame is squashed into the square working buffer, so a circle in the source is an
// ellipse in there. These shrink the long source axis back, keeping the sampled ring
// round in the image and sized to the shorter side at radius 1.
export function rimScale(aspect: number): { x: number; y: number } {
  return aspect >= 1 ? { x: 1 / aspect, y: 1 } : { x: 1, y: aspect };
}

// Byte offsets into the sampled frame for every light, grouped by light. Geometry only
// changes when someone drags a slider, so the trigonometry is done once and the per
// frame work is a flat walk over this table.
function buildRimLut(lights: number, g: VideoGeometry, aspect: number): Int32Array {
  const lut = new Int32Array(lights * ARC_SAMPLES * RADIAL_SAMPLES);
  const cx = g.centerX * SAMPLE_SIZE;
  const cy = g.centerY * SAMPLE_SIZE;
  const scale = rimScale(aspect);
  const rmaxX = g.radius * SAMPLE_SIZE * 0.5 * scale.x;
  const rmaxY = g.radius * SAMPLE_SIZE * 0.5 * scale.y;
  const last = SAMPLE_SIZE - 1;
  const clamp = (v: number) => (v < 0 ? 0 : v > last ? last : v);

  let n = 0;
  for (let i = 0; i < lights; i++) {
    for (let a = 0; a < ARC_SAMPLES; a++) {
      // Light 0 reads `rotation` of a turn clockwise from the top of the frame and the
      // rest follow it, which is what the y-down canvas axis makes of an increasing
      // angle. The offset lines the feed's own "up" up with the top of the ring.
      const turn = (i + (a + 0.5) / ARC_SAMPLES) / lights + g.rotation;
      const angle = turn * Math.PI * 2 - Math.PI / 2;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);

      for (let k = 0; k < RADIAL_SAMPLES; k++) {
        const f = 1 + g.ringWidth * ((k + 0.5) / RADIAL_SAMPLES - 0.5);
        const x = clamp(Math.round(cx + dx * rmaxX * f));
        const y = clamp(Math.round(cy + dy * rmaxY * f));
        lut[n++] = (y * SAMPLE_SIZE + x) * 4;
      }
    }
  }
  return lut;
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
  const sampleStrip = (): number => {
    const width = Math.min(VIDEO_MAX_WIDTH, video.videoWidth);
    const frame = video.videoHeight;
    const g = geometry();
    const band = Math.min(frame, Math.max(1, Math.round(g.stripHeight * frame)));
    const top = Math.min(
      frame - band,
      Math.max(0, Math.round(g.stripY * frame - band / 2))
    );

    resize(width, 1);
    ctx.drawImage(video, 0, top, video.videoWidth, band, 0, 0, width, 1);

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
  const sampleRim = (): number => {
    resize(SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    const g = geometry();
    const aspect = video.videoWidth / video.videoHeight;
    const key = `${g.centerX}|${g.centerY}|${g.radius}|${g.ringWidth}|${g.rotation}|${aspect}`;
    if (key !== lutKey) {
      lut = buildRimLut(lights, g, aspect);
      lutKey = key;
    }

    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const per = ARC_SAMPLES * RADIAL_SAMPLES;
    let n = 0;
    for (let i = 0; i < lights; i++) {
      let r = 0;
      let g2 = 0;
      let b = 0;
      for (let s = 0; s < per; s++) {
        const o = lut[n++];
        r += LINEAR[data[o]];
        g2 += LINEAR[data[o + 1]];
        b += LINEAR[data[o + 2]];
      }
      strip[i * 3] = encode(r / per);
      strip[i * 3 + 1] = encode(g2 / per);
      strip[i * 3 + 2] = encode(b / per);
    }
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

    const width = mode() === 'strip' ? sampleStrip() : sampleRim();
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
