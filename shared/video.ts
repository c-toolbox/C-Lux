// The video contract shared by the browser capture client, the server ingest endpoint,
// the server's NDI receiver, and the Video pattern: the strip shape, the store holding
// the most recent one, and the geometry and sampling maths both capture paths use. On
// the server the ingest endpoint and the NDI receiver publish into the store; in the
// browser the store stays empty.
//
// A "strip" is a one-dimensional row of colors. Both capture modes reduce to it: a wide,
// short video collapses to its own pixel columns, and a fisheye feed collapses to the
// colors sampled around its rim. Carrying the width means the capture side never has to
// know how many lights the installation has.

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

//
// Sampling — how a frame is reduced to a strip. Shared so the browser (sampling a camera
// or a shared window) and the server (sampling an NDI stream) read the same pixels for
// the same settings, and so the calibration overlay drawn in the browser describes what
// the server is actually reading.
//

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

// Working resolution for fisheye sampling. Every light averages a patch of the rim, so
// resolving the source any finer than this only makes the sampling more expensive.
export const RIM_SAMPLE_SIZE = 256;

// Samples averaged per light: a few steps along the rim and a few across its width.
const ARC_SAMPLES = 4;
const RADIAL_SAMPLES = 4;
const RIM_SAMPLES_PER_LIGHT = ARC_SAMPLES * RADIAL_SAMPLES;

// Averaging has to happen in linear light. Averaging sRGB values directly pulls any mix
// of a bright and a dark sample towards the dark one, which turns a lively rim muddy.
export const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

export function linearToSrgb(linear: number): number {
  const c =
    linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  const byte = Math.round(c * 255);
  return byte < 0 ? 0 : byte > 255 ? 255 : byte;
}

// The frame is squashed into the square working buffer, so a circle in the source is an
// ellipse in there. These shrink the long source axis back, keeping the sampled ring
// round in the image and sized to the shorter side at radius 1.
export function rimScale(aspect: number): { x: number; y: number } {
  return aspect >= 1 ? { x: 1 / aspect, y: 1 } : { x: 1, y: aspect };
}

// Byte offsets into a `RIM_SAMPLE_SIZE` square RGBA buffer for every light, grouped by
// light. Geometry only changes when someone drags a slider, so the trigonometry is done
// once and the per frame work is a flat walk over this table.
export function buildRimLut(
  lights: number,
  g: VideoGeometry,
  aspect: number
): Int32Array {
  const lut = new Int32Array(lights * RIM_SAMPLES_PER_LIGHT);
  const cx = g.centerX * RIM_SAMPLE_SIZE;
  const cy = g.centerY * RIM_SAMPLE_SIZE;
  const scale = rimScale(aspect);
  const rmaxX = g.radius * RIM_SAMPLE_SIZE * 0.5 * scale.x;
  const rmaxY = g.radius * RIM_SAMPLE_SIZE * 0.5 * scale.y;
  const last = RIM_SAMPLE_SIZE - 1;
  const clamp = (v: number) => (v < 0 ? 0 : v > last ? last : v);

  let n = 0;
  for (let i = 0; i < lights; i++) {
    for (let a = 0; a < ARC_SAMPLES; a++) {
      // Light 0 reads `rotation` of a turn clockwise from the top of the frame and the
      // rest follow it, which is what the y-down image axis makes of an increasing
      // angle. The offset lines the feed's own "up" up with the top of the ring.
      const turn = (i + (a + 0.5) / ARC_SAMPLES) / lights + g.rotation;
      const angle = turn * Math.PI * 2 - Math.PI / 2;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);

      for (let k = 0; k < RADIAL_SAMPLES; k++) {
        const f = 1 + g.ringWidth * ((k + 0.5) / RADIAL_SAMPLES - 0.5);
        const x = clamp(Math.round(cx + dx * rmaxX * f));
        const y = clamp(Math.round(cy + dy * rmaxY * f));
        lut[n++] = (y * RIM_SAMPLE_SIZE + x) * 4;
      }
    }
  }
  return lut;
}

// Average the annulus described by `lut` into `strip`, one patch of the square RGBA
// buffer per light. `strip` is written as packed rgb and must hold `lights * 3` bytes.
export function sampleRim(
  square: Uint8Array | Uint8ClampedArray,
  lut: Int32Array,
  lights: number,
  strip: Uint8Array
): void {
  let n = 0;
  for (let i = 0; i < lights; i++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let s = 0; s < RIM_SAMPLES_PER_LIGHT; s++) {
      const o = lut[n++];
      r += SRGB_TO_LINEAR[square[o]];
      g += SRGB_TO_LINEAR[square[o + 1]];
      b += SRGB_TO_LINEAR[square[o + 2]];
    }
    strip[i * 3] = linearToSrgb(r / RIM_SAMPLES_PER_LIGHT);
    strip[i * 3 + 1] = linearToSrgb(g / RIM_SAMPLES_PER_LIGHT);
    strip[i * 3 + 2] = linearToSrgb(b / RIM_SAMPLES_PER_LIGHT);
  }
}

// The band of the frame strip mode collapses, as pixel rows, clamped to the frame.
export function stripBand(
  g: VideoGeometry,
  height: number
): { top: number; rows: number } {
  const rows = Math.min(height, Math.max(1, Math.round(g.stripHeight * height)));
  const top = Math.min(
    height - rows,
    Math.max(0, Math.round(g.stripY * height - rows / 2))
  );
  return { top, rows };
}
