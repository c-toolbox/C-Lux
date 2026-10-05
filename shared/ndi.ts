// The NDI contract shared by the capture panel in the browser and the receiver on the
// server. NDI is a LAN protocol a browser cannot speak, so unlike camera and screen
// capture the whole feed is handled server-side: the enabled Video pattern names the
// source and the sampling geometry, and the browser only lists the senders on the
// network and watches a preview of what the server is reading.

// One sender the finder has seen on the network. `name` is what a Video pattern stores
// as its `ndiSource`.
export interface NdiSource {
  name: string;
  urlAddress?: string;
}

export interface NdiStatus {
  // False once the optional native bindings have failed to load, with `reason` saying
  // why. Stays true until the first attempt, because loading is deferred.
  supported: boolean;
  reason: string | null;
  running: boolean;
  // The source the enabled Video pattern asks for, whether or not it could be opened.
  source: string | null;
  // Senders currently connected to our receiver: 0 means the source has gone away.
  connections: number;
  // Why the requested source is not running, or the last receive failure.
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
