// The audio-analysis contract shared by the browser capture client, the server ingest
// endpoint, and the Audio pattern: the frame shape, the band count, and the store
// holding the most recent frame. On the server the ingest endpoint publishes into the
// store; in the browser the store simply stays silent.

// How many frequency bands a capture client streams. Fixed so the browser analyser and
// the pattern agree on the layout without having to negotiate one.
export const AUDIO_BANDS = 32;

// Bands are spread logarithmically over the range that carries musical content; below
// and above this the analyser mostly reports rumble and hiss.
export const AUDIO_MIN_HZ = 30;
export const AUDIO_MAX_HZ = 16000;

// Fractional band index of a frequency, where whole numbers land on band centres. Values
// outside the captured range fall outside [0, AUDIO_BANDS - 1] and are left to the caller
// to clamp.
export function audioBandIndex(hz: number): number {
  const ratio = Math.log(hz / AUDIO_MIN_HZ) / Math.log(AUDIO_MAX_HZ / AUDIO_MIN_HZ);
  return ratio * AUDIO_BANDS - 0.5;
}

// Treat the stream as silent once no client has published for this long, so the lights
// fall dark instead of freezing on the last frame when capture stops.
const STALE_MS = 750;

interface AudioFrame {
  // Per-band magnitude in [0, 1], lowest frequency first.
  bands: number[];
  // Overall loudness in [0, 1].
  level: number;
}

function silence(): AudioFrame {
  return { bands: new Array<number>(AUDIO_BANDS).fill(0), level: 0 };
}

// The most recent frame of every feed, keyed by the name of the Audio pattern it feeds,
// so several patterns can each follow their own capture.
const feeds = new Map<string, { frame: AudioFrame; at: number }>();

// Record an already-validated frame from a capture client (the server ingest endpoint
// is responsible for validating and clamping the raw request body first).
export function setAudioFrame(feed: string, bands: number[], level: number): void {
  const now = Date.now();
  // Feeds that went quiet are dropped, so the store can't outgrow the live captures.
  for (const [key, entry] of feeds) {
    if (now - entry.at > STALE_MS) feeds.delete(key);
  }
  feeds.set(feed, { frame: { bands, level }, at: now });
}

// The most recent frame of a feed, or silence when nothing has arrived recently.
export function audioFrame(feed: string): AudioFrame {
  const entry = feeds.get(feed);
  if (entry === undefined || Date.now() - entry.at > STALE_MS) return silence();
  return entry.frame;
}
