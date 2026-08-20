import { HttpError } from './errors.ts';

// How many frequency bands a capture client streams. Fixed so the browser analyser and
// the pattern agree on the layout without having to negotiate one.
export const AUDIO_BANDS = 32;

// Treat the stream as silent once no client has published for this long, so the lights
// fall dark instead of freezing on the last frame when capture stops.
const STALE_MS = 750;

export interface AudioFrame {
  // Per-band magnitude in [0, 1], lowest frequency first.
  bands: number[];
  // Overall loudness in [0, 1].
  level: number;
  // False when nothing is currently streaming.
  live: boolean;
}

function silence(): AudioFrame {
  return { bands: new Array<number>(AUDIO_BANDS).fill(0), level: 0, live: false };
}

const clampUnit = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

let latest = silence();
let latestAt = 0;

// Accept a frame from a capture client. The shape is checked strictly so a malformed
// post can't feed NaN or an unexpected length into the pattern state.
export function publishAudioFrame(body: unknown): AudioFrame {
  const { bands, level } = (body ?? {}) as { bands?: unknown; level?: unknown };

  if (!Array.isArray(bands) || bands.length !== AUDIO_BANDS) {
    throw new HttpError(400, `bands must be an array of ${AUDIO_BANDS} numbers`);
  }
  if (typeof level !== 'number' || !Number.isFinite(level)) {
    throw new HttpError(400, 'level must be a finite number');
  }

  const values = bands.map((value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new HttpError(400, 'bands must contain only finite numbers');
    }
    return clampUnit(value);
  });

  latest = { bands: values, level: clampUnit(level), live: true };
  latestAt = Date.now();
  return latest;
}

// The most recent frame, or silence when nothing has arrived recently.
export function audioFrame(): AudioFrame {
  if (Date.now() - latestAt > STALE_MS) return silence();
  return latest;
}
