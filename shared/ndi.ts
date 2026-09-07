// The NDI contract shared by the capture panel in the browser and the receiver on the
// server. NDI is a LAN protocol a browser cannot speak, so unlike camera and screen
// capture the whole feed is handled server-side: the browser only picks a source, aims
// the sampling geometry, and watches a preview of what the server is reading.

import type { VideoGeometry, VideoMode } from './video.ts';

// One sender the finder has seen on the network. `name` is what the user picks from and
// what the server matches an incoming request against.
export interface NdiSource {
  name: string;
  urlAddress?: string;
}

// A change to the receiver. `source` names the sender to open, or null to stop; leaving
// it out keeps whatever is running and only re-aims the sampling.
export interface NdiUpdate {
  source?: string | null;
  mode?: VideoMode;
  geometry?: VideoGeometry;
}

export interface NdiStatus {
  // False once the optional native bindings have failed to load, with `reason` saying
  // why. Stays true until the first attempt, because loading is deferred.
  supported: boolean;
  reason: string | null;
  running: boolean;
  source: string | null;
  mode: VideoMode;
  geometry: VideoGeometry;
  // Senders currently connected to our receiver: 0 means the source has gone away.
  connections: number;
  // The last receive failure, cleared when a new source is opened.
  error: string | null;
}

// The preview the server renders from the frames it is sampling, so the calibration
// sliders can be aimed by eye without the browser touching the stream.
//
//   [0..1] preview width, uint16 little-endian
//   [2..3] preview height
//   [4..5] strip width
//   [6..]  preview r, g, b per pixel, then the sampled strip's r, g, b per color
export const NDI_PREVIEW_HEADER_BYTES = 6;

// Big enough to aim a ring by eye, small enough to re-render and ship 10 times a second.
export const NDI_PREVIEW_WIDTH = 320;
export const NDI_PREVIEW_MAX_HEIGHT = 320;

// How often the browser asks for a new preview frame while the panel is open.
export const NDI_PREVIEW_INTERVAL_MS = 100;
