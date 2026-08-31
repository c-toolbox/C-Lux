import { setVideoStrip, VIDEO_MAX_WIDTH } from '../shared/video';

import { HttpError } from './errors';

// A strip is posted as a binary body rather than JSON: the same frame as a JSON number
// array is four times the bytes and has to be parsed tens of times a second.
//
//   [0..1] width, uint16 little-endian
//   [2..]  r, g, b per color
const HEADER_BYTES = 2;

// Validate and accept one strip from a capture client. `express.raw` caps the body size
// before this runs, so the only checks left are that the header agrees with the payload.
export function publishVideoStrip(body: unknown): void {
  if (!Buffer.isBuffer(body) || body.length < HEADER_BYTES) {
    throw new HttpError(400, 'video frame must be an application/octet-stream body');
  }

  const width = body.readUInt16LE(0);
  if (width < 1 || width > VIDEO_MAX_WIDTH) {
    throw new HttpError(400, `width must be between 1 and ${VIDEO_MAX_WIDTH}`);
  }
  if (body.length !== HEADER_BYTES + width * 3) {
    throw new HttpError(400, 'frame length does not match its width');
  }

  // Copied out of the request buffer: express recycles it once the response is sent.
  setVideoStrip(width, Uint8Array.from(body.subarray(HEADER_BYTES)));
}
