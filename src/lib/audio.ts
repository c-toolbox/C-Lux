import { AUDIO_BANDS } from '../../shared/audio';

// Where the audio the browser captures is sent so the server-side pattern can read it.
const ENDPOINT = '/api/audio';

const FFT_SIZE = 2048;

// Bands are spread logarithmically over the range that carries musical content; below
// and above this the analyser mostly reports rumble and hiss.
const MIN_HZ = 30;
const MAX_HZ = 16000;

// Matches the server tick rate; posting faster only adds requests the engine never sees.
const POST_INTERVAL_MS = 1000 / 30;

// Typical music sits well below full scale, so the RMS is scaled to make a VU meter
// span most of the ring at a normal listening level.
const LEVEL_SCALE = 3;

// 'system' taps whatever the sound card is playing; 'input' records a capture device
// such as a line-in, a microphone, or a loopback ("Stereo Mix") device.
export type AudioSource = 'system' | 'input';

export interface AudioCaptureHandle {
  stop: () => void;
}

export interface AudioCaptureOptions {
  source: AudioSource;
  // Called every analysis frame with the current loudness in [0, 1], for a meter.
  onLevel: (level: number) => void;
  // Called when the browser ends the capture on its own (e.g. "Stop sharing").
  onEnded: () => void;
}

// Never resample or clean up the signal: this is a measurement, not a call.
const RAW: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
};

async function openStream(source: AudioSource): Promise<MediaStream> {
  if (source === 'input') return navigator.mediaDevices.getUserMedia({ audio: RAW });

  // Chromium only hands out the system/tab audio track alongside a video track, so one
  // has to be requested even though it is never rendered.
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: RAW });
}

// Capture audio in this tab, analyse it, and stream the result to the server until the
// returned handle is stopped.
export async function startAudioCapture({
  source,
  onLevel,
  onEnded
}: AudioCaptureOptions): Promise<AudioCaptureHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not allow audio capture on this page');
  }

  const stream = await openStream(source);
  const [track] = stream.getAudioTracks();
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(
      source === 'system'
        ? 'No audio was shared. Enable "Share system audio" in the picker.'
        : 'The selected input device provided no audio.'
    );
  }

  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.6;
  context.createMediaStreamSource(stream).connect(analyser);
  await context.resume();

  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  const waveform = new Uint8Array(analyser.fftSize);
  const bands = new Array<number>(AUDIO_BANDS).fill(0);
  let posting = false;

  const timer = setInterval(() => {
    analyser.getByteFrequencyData(spectrum);
    analyser.getByteTimeDomainData(waveform);
    fillBands(spectrum, context.sampleRate, bands);

    const level = loudness(waveform);
    onLevel(level);

    // Drop a frame rather than queue behind a slow request; the next one is 33ms away.
    if (posting) return;
    posting = true;
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bands, level })
    })
      .catch(() => undefined)
      .finally(() => {
        posting = false;
      });
  }, POST_INTERVAL_MS);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void context.close();
  };

  // The browser's own "stop sharing" control ends the track without going through us.
  track.addEventListener('ended', () => {
    stop();
    onEnded();
  });

  return { stop };
}

// Fold the linear FFT bins into logarithmically spaced bands, which is far closer to how
// the ear splits up a spectrum than the raw bins are.
function fillBands(spectrum: Uint8Array, sampleRate: number, out: number[]): void {
  const binHz = sampleRate / 2 / spectrum.length;
  const ratio = MAX_HZ / MIN_HZ;

  for (let i = 0; i < out.length; i++) {
    const low = MIN_HZ * Math.pow(ratio, i / out.length);
    const high = MIN_HZ * Math.pow(ratio, (i + 1) / out.length);

    const first = Math.min(spectrum.length - 1, Math.floor(low / binHz));
    const last = Math.max(first, Math.min(spectrum.length - 1, Math.ceil(high / binHz)));

    let peak = 0;
    for (let bin = first; bin <= last; bin++) peak = Math.max(peak, spectrum[bin]);
    out[i] = peak / 255;
  }
}

// RMS of the waveform, which tracks perceived loudness far better than a peak does.
function loudness(waveform: Uint8Array): number {
  let sum = 0;
  for (const sample of waveform) {
    const value = (sample - 128) / 128;
    sum += value * value;
  }
  return Math.min(1, Math.sqrt(sum / waveform.length) * LEVEL_SCALE);
}
