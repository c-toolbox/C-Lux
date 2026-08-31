// The video contract shared by the browser capture client, the server ingest endpoint,
// and the Video pattern: the strip shape and the store holding the most recent one. On
// the server the ingest endpoint publishes into the store; in the browser it stays empty.
//
// A "strip" is a one-dimensional row of colors. Both capture modes reduce to it: a wide,
// short video collapses to its own pixel columns, and a fisheye feed collapses to the
// colors sampled around its rim. Carrying the width means the browser never has to know
// how many lights the installation has.

// Guards the ingest endpoint against an absurd allocation; far wider than any ring.
export const VIDEO_MAX_WIDTH = 1024;

// Treat the feed as gone once no client has published for this long, so the lights fade
// out instead of freezing on the last frame when capture stops.
const STALE_MS = 500;

export interface VideoStrip {
  // Number of colors in the strip.
  width: number;
  // Packed 8-bit sRGB, `width * 3` long.
  rgb: Uint8Array;
}

let latest: VideoStrip | null = null;
let latestAt = 0;

// Record an already-validated strip from a capture client (the server ingest endpoint is
// responsible for checking the raw request body first).
export function setVideoStrip(width: number, rgb: Uint8Array): void {
  latest = { width, rgb };
  latestAt = Date.now();
}

// The most recent strip, or null when nothing has arrived recently.
export function videoStrip(): VideoStrip | null {
  if (latest === null || Date.now() - latestAt > STALE_MS) return null;
  return latest;
}
