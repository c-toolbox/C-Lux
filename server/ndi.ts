import type { ReceivedVideoFrame, Receiver, Source } from 'grandi';

import {
  NDI_PREVIEW_MAX_HEIGHT,
  NDI_PREVIEW_WIDTH,
  type NdiSource,
  type NdiStatus
} from '../shared/ndi';
import {
  buildRimLut,
  DEFAULT_VIDEO_GEOMETRY,
  linearToSrgb,
  RIM_SAMPLE_SIZE,
  sampleRim,
  setVideoStrip,
  SRGB_TO_LINEAR,
  stripBand,
  VIDEO_MAX_WIDTH,
  VIDEO_SAMPLING_FISHEYE,
  VIDEO_SAMPLING_STRIP,
  type VideoGeometry
} from '../shared/video';

import { config } from './config';
import { HttpError } from './errors';

// mDNS discovery needs a moment on a cold finder; once it is warm the snapshot is
// already there and a poll only has to give a newly appeared sender time to land.
const FIND_COLD_MS = 1500;
const FIND_WARM_MS = 150;

// How long to wait for a frame before looping. Short enough that stopping the receiver
// is not noticeably delayed, long enough not to spin.
const FRAME_TIMEOUT_MS = 250;

// Back off after a receive error rather than hammering a source that is failing. Kept
// well under the video store's staleness window (shared/video.ts STALE_MS) so a single
// transient error - a dropped packet, a momentary sender hiccup - doesn't itself force
// the strip to go stale and the pattern to visibly flash to black.
const RETRY_MS = 50;

// How long to wait before trying again to open a source a Video pattern asks for but
// that could not be opened, e.g. because its sender is not on the network yet.
const REOPEN_MS = 5000;

// Stop rendering previews once no one has asked for one for this long.
const PREVIEW_IDLE_MS = 2000;

// While a source is connected, re-publish the last strip on this interval so the video
// store stays fresh between frames. An NDI sender's video rate is its own business and can
// sit well under the store's staleness window (shared/video.ts STALE_MS) while the feed is
// perfectly live - a static NDI Test Pattern sends video at 1 fps, and audio frames in
// between keep the receive loop from ever seeing an idle tick. Without this the Video
// pattern fades to black and back once a second. Kept well under STALE_MS.
const HOLD_REFRESH_MS = 200;

// ...but stop holding once no real frame has landed for this long, even if the receiver
// still claims a connection: a half-dead source (audio flowing, video wedged) should fade
// out rather than freeze the ring on its last frame forever.
const HOLD_MAX_MS = 10_000;

// Source pixels read per destination pixel when scaling a frame down. Uncapped, a 4K
// feed would cost more per frame than the whole engine does.
const MAX_TAPS = 4;

const lights = Math.min(VIDEO_MAX_WIDTH, config.nLights);

type Ndi = typeof import('grandi');

//
// Loading. The bindings are an optional native dependency wrapping the NDI runtime, so
// the rest of C-Lux has to run on a machine without either. The module is pulled in the
// first time someone asks for NDI and a failure is reported through the API rather than
// thrown at startup.
//

let library: Promise<Ndi | null> | null = null;
let unavailable: string | null = null;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function load(): Promise<Ndi | null> {
  library ??= import('grandi').then(
    (module) => {
      unavailable = null;
      return module;
    },
    (err: unknown) => {
      const { code } = err as { code?: string };
      unavailable =
        code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND'
          ? 'NDI support is not installed on the server (optional dependency "grandi")'
          : `NDI support could not be loaded: ${describe(err)}`;
      return null;
    }
  );
  return library;
}

async function required(): Promise<Ndi> {
  const ndi = await load();
  if (ndi === null) throw new HttpError(503, unavailable ?? 'NDI is unavailable');

  // The bindings load their JavaScript on any platform and only fall back to a stub when
  // there is no addon for this platform and CPU, so being importable is not enough.
  if (!ndi.isSupportedCPU()) {
    unavailable = `NDI is not supported on this machine (${process.platform}-${process.arch})`;
    throw new HttpError(503, unavailable);
  }
  return ndi;
}

//
// Discovery. The finder is kept alive between requests: creating one per request would
// restart discovery every time and never see anything.
//

let finder: Awaited<ReturnType<Ndi['find']>> | null = null;

// Several receivers may open at once; they share one look at the network rather than
// racing to create a finder each.
let discovering: Promise<Source[]> | null = null;

function discover(): Promise<Source[]> {
  discovering ??= lookAround().finally(() => {
    discovering = null;
  });
  return discovering;
}

async function lookAround(): Promise<Source[]> {
  const ndi = await required();

  try {
    if (finder === null) {
      finder = await ndi.find({ showLocalSources: true });
      await finder.wait(FIND_COLD_MS);
    } else {
      await finder.wait(FIND_WARM_MS);
    }
  } catch (err) {
    finder = null;
    throw new HttpError(503, `NDI discovery failed: ${describe(err)}`);
  }
  return finder.sources();
}

export async function ndiSources(): Promise<NdiSource[]> {
  return (await discover()).map(({ name, urlAddress }) => ({ name, urlAddress }));
}

//
// Receiving. One receiver per Video pattern that asks for an NDI stream, each pumped by a
// loop that publishes every frame into that pattern's feed in the shared video store,
// the way the browser's POST /api/patterns/:name/video does. See `syncNdi`.
//

// The frame squashed into a square RGBA working buffer, the same image the browser's
// canvas produces, so both paths sample identically for the same geometry. Shared by
// every receiver: a frame is sampled synchronously, start to finish.
const square = new Uint8Array(RIM_SAMPLE_SIZE * RIM_SAMPLE_SIZE * 4);
const row = new Uint8Array(VIDEO_MAX_WIDTH * 4);

// Average a rectangle of an RGBA image down to `dstW` x `dstH`, in linear light, writing
// RGBA into `dst`. Everything the receiver samples — the square rim buffer, the strip's
// single row, the preview — is this same reduction with different targets.
function boxDownscale(
  src: Uint8Array,
  srcStride: number,
  srcWidth: number,
  srcTop: number,
  srcRows: number,
  dst: Uint8Array,
  dstW: number,
  dstH: number
): void {
  const stepX = srcWidth / dstW;
  const stepY = srcRows / dstH;
  const tapsX = Math.min(MAX_TAPS, Math.max(1, Math.floor(stepX)));
  const tapsY = Math.min(MAX_TAPS, Math.max(1, Math.floor(stepY)));
  const taps = tapsX * tapsY;
  const lastX = srcWidth - 1;
  const lastY = srcTop + srcRows - 1;

  let out = 0;
  for (let y = 0; y < dstH; y++) {
    const top = srcTop + y * stepY;
    for (let x = 0; x < dstW; x++) {
      const left = x * stepX;
      let r = 0;
      let g = 0;
      let b = 0;

      for (let ty = 0; ty < tapsY; ty++) {
        const sy = Math.min(lastY, Math.floor(top + ((ty + 0.5) / tapsY) * stepY));
        const line = sy * srcStride;
        for (let tx = 0; tx < tapsX; tx++) {
          const sx = Math.min(lastX, Math.floor(left + ((tx + 0.5) / tapsX) * stepX));
          const p = line + sx * 4;
          r += SRGB_TO_LINEAR[src[p]];
          g += SRGB_TO_LINEAR[src[p + 1]];
          b += SRGB_TO_LINEAR[src[p + 2]];
        }
      }

      dst[out++] = linearToSrgb(r / taps);
      dst[out++] = linearToSrgb(g / taps);
      dst[out++] = linearToSrgb(b / taps);
      dst[out++] = 255;
    }
  }
}

// Set NDI_DEBUG=1 to log a once-a-second summary of what the receiver is actually
// delivering (event mix, video frame interval, frame shape, connections, hold ticks).
// Cheap to leave in: everything below is a no-op unless the variable is set.
const DEBUG = process.env.NDI_DEBUG === '1';
const dbg = {
  since: 0,
  events: new Map<string, number>(),
  lastVideo: 0,
  gapMax: 0,
  shortFrames: 0,
  holds: 0,
  lastShape: ''
};
function dbgTick(active: Receiver): void {
  const now = Date.now();
  if (dbg.since === 0) dbg.since = now;
  if (now - dbg.since < 1000) return;
  const mix = [...dbg.events].map(([k, v]) => `${k}:${v}`).join(' ');
  console.warn(
    `[ndi-debug] ${mix} | video gap max ${dbg.gapMax}ms | holds ${dbg.holds} | ` +
      `short ${dbg.shortFrames} | ${dbg.lastShape} | connections ${active.connections()}`
  );
  dbg.since = now;
  dbg.events.clear();
  dbg.gapMax = 0;
  dbg.shortFrames = 0;
  dbg.holds = 0;
}
function dbgEvent(type: string): void {
  if (!DEBUG) return;
  dbg.events.set(type, (dbg.events.get(type) ?? 0) + 1);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The receiver feeding one Video pattern, and everything it keeps between frames.
class FeedReceiver {
  private readonly feed: string;

  // The source the pattern asks for, and how it wants the frames sampled.
  wanted: string | null = null;
  private sampling = VIDEO_SAMPLING_FISHEYE;
  private geometry: VideoGeometry = DEFAULT_VIDEO_GEOMETRY;

  receiver: Receiver | null = null;
  error: string | null = null;

  // An open in flight, and when a failed open may be retried.
  private opening = false;
  private reopenAt = 0;

  // Bumped on every stop, so a pump that is mid-await knows it has been replaced and
  // stops without publishing a frame the new receiver should own.
  private generation = 0;

  // Re-publishes the last strip between frames while the source is connected. See
  // HOLD_REFRESH_MS. Cleared by stop().
  private holdTimer: ReturnType<typeof setInterval> | null = null;

  private readonly strip = new Uint8Array(VIDEO_MAX_WIDTH * 3);
  private lut: Int32Array = new Int32Array(0);
  private lutKey = '';

  // Width of the strip published from the last frame, so the preview can carry it back.
  private stripWidth = 0;

  // When the last real video frame was sampled, so the hold timer knows how long to keep
  // re-publishing it before treating the source as gone. See HOLD_MAX_MS.
  private lastVideoAt = 0;

  private previewWantedUntil = 0;
  private preview: { width: number; height: number; rgb: Uint8Array } | null = null;

  constructor(feed: string) {
    this.feed = feed;
  }

  // Bring the receiver in line with what the pattern asks for. Re-aiming is free, a new
  // source is opened in the background, and a source that could not be opened is
  // retried every `REOPEN_MS`.
  sync(request: NdiRequest | null): void {
    if (request !== null)
      ({ sampling: this.sampling, geometry: this.geometry } = request);

    const next = request?.source || null;
    if (next !== this.wanted) {
      this.wanted = next;
      this.error = null;
      this.reopenAt = 0;
      if (this.receiver !== null) this.stop();
    }

    const name = this.wanted;
    if (name === null || this.receiver !== null || this.opening) return;
    if (Date.now() < this.reopenAt) return;

    this.opening = true;
    this.start(name)
      .catch((err: unknown) => {
        const message = describe(err);
        if (message !== this.error) console.warn(`NDI (${this.feed}): ${message}`);
        if (this.wanted === name) this.error = message;
        this.reopenAt = Date.now() + REOPEN_MS;
      })
      .finally(() => {
        this.opening = false;
      });
  }

  close(): void {
    this.wanted = null;
    this.stop();
  }

  status(): NdiStatus {
    return {
      supported: unavailable === null,
      reason: unavailable,
      running: this.receiver !== null,
      source: this.wanted,
      connections: this.receiver?.connections() ?? 0,
      error: this.error
    };
  }

  // The latest preview frame, or null until one has been rendered. Asking for one is
  // what makes the receiver render them at all. The buffers are live and are
  // overwritten by the next frame, so the caller has to serialize them before yielding.
  takePreview(): NdiPreview | null {
    this.previewWantedUntil = Date.now() + PREVIEW_IDLE_MS;
    if (this.preview === null) return null;
    return { ...this.preview, strip: this.strip.subarray(0, this.stripWidth * 3) };
  }

  private sampleFisheye(pixels: Uint8Array, stride: number, w: number, h: number) {
    boxDownscale(pixels, stride, w, 0, h, square, RIM_SAMPLE_SIZE, RIM_SAMPLE_SIZE);

    const aspect = w / h;
    const g = this.geometry;
    const key = `${g.centerX}|${g.centerY}|${g.radius}|${g.ringWidth}|${g.rotation}|${aspect}`;
    if (key !== this.lutKey) {
      this.lut = buildRimLut(lights, g, aspect);
      this.lutKey = key;
    }

    sampleRim(square, this.lut, lights, this.strip);
    return lights;
  }

  private sampleStrip(pixels: Uint8Array, stride: number, w: number, h: number) {
    const width = Math.min(VIDEO_MAX_WIDTH, w);
    const { top, rows } = stripBand(this.geometry, h);

    boxDownscale(pixels, stride, w, top, rows, row, width, 1);
    for (let i = 0; i < width; i++) {
      this.strip[i * 3] = row[i * 4];
      this.strip[i * 3 + 1] = row[i * 4 + 1];
      this.strip[i * 3 + 2] = row[i * 4 + 2];
    }
    return width;
  }

  private renderPreview(pixels: Uint8Array, stride: number, w: number, h: number) {
    const width = Math.min(NDI_PREVIEW_WIDTH, w);
    const height = Math.min(
      NDI_PREVIEW_MAX_HEIGHT,
      Math.max(1, Math.round(width / (w / h)))
    );

    let { preview } = this;
    if (preview === null || preview.width !== width || preview.height !== height) {
      preview = { width, height, rgb: new Uint8Array(width * height * 3) };
      this.preview = preview;
    }

    const rgba = new Uint8Array(width * height * 4);
    boxDownscale(pixels, stride, w, 0, h, rgba, width, height);
    for (let i = 0; i < width * height; i++) {
      preview.rgb[i * 3] = rgba[i * 4];
      preview.rgb[i * 3 + 1] = rgba[i * 4 + 1];
      preview.rgb[i * 3 + 2] = rgba[i * 4 + 2];
    }
  }

  private publish(frame: ReceivedVideoFrame): void {
    const { xres, yres, lineStrideBytes, data } = frame;
    if (DEBUG) {
      const now = Date.now();
      if (dbg.lastVideo !== 0) dbg.gapMax = Math.max(dbg.gapMax, now - dbg.lastVideo);
      dbg.lastVideo = now;
      dbg.lastShape = `${xres}x${yres} stride ${lineStrideBytes} bytes ${data.length}/${lineStrideBytes * yres}`;
      if (xres < 1 || yres < 1 || data.length < lineStrideBytes * yres) dbg.shortFrames++;
    }
    if (xres < 1 || yres < 1 || data.length < lineStrideBytes * yres) return;

    const width =
      this.sampling === VIDEO_SAMPLING_STRIP
        ? this.sampleStrip(data, lineStrideBytes, xres, yres)
        : this.sampleFisheye(data, lineStrideBytes, xres, yres);

    // The working buffer is reused every frame, so the store gets its own copy.
    setVideoStrip(this.feed, width, this.strip.slice(0, width * 3), 'ndi');
    this.stripWidth = width;
    this.lastVideoAt = Date.now();

    if (Date.now() < this.previewWantedUntil) {
      this.renderPreview(data, lineStrideBytes, xres, yres);
    }
  }

  // Pull frames until this receiver is replaced or stopped. `data` resolves with a
  // timeout event rather than rejecting, so a source that goes quiet just stops feeding
  // `publish`; the hold timer keeps the strip alive until the source actually
  // disconnects. Destroying happens here, once no call is in flight.
  private async pump(active: Receiver, id: number): Promise<void> {
    while (this.generation === id) {
      try {
        const event = await active.data(FRAME_TIMEOUT_MS);
        if (this.generation !== id) break;
        dbgEvent(event.type);
        if (event.type === 'video') this.publish(event);
        if (DEBUG) dbgTick(active);
      } catch (err) {
        if (this.generation !== id) break;
        this.error = describe(err);
        console.warn(`NDI (${this.feed}) receive error, retrying: ${this.error}`);
        await delay(RETRY_MS);
      }
    }
    active.destroy();
  }

  private stop(): void {
    this.generation++;
    if (this.holdTimer !== null) {
      clearInterval(this.holdTimer);
      this.holdTimer = null;
    }
    this.receiver = null;
    this.preview = null;
    this.stripWidth = 0;
    this.lastVideoAt = 0;
  }

  private async start(name: string): Promise<void> {
    const ndi = await required();

    // Only a sender discovery has actually seen may be opened, so a pattern cannot aim
    // the server's receiver at an arbitrary host on the network.
    const source = (await discover()).find((candidate) => candidate.name === name);
    if (source === undefined) {
      throw new HttpError(404, `No NDI source named "${name}" was found on the network`);
    }

    let opened: Receiver;
    try {
      opened = await ndi.receive({
        source,
        // Ask the SDK for RGBA: it converts far more cheaply than unpacking UYVY here.
        colorFormat: ndi.ColorFormat.RGBX_RGBA,
        // Every frame collapses to a row of a few hundred colors, so the proxy stream
        // still carries more detail than the ring can show at a fraction of the
        // bandwidth.
        bandwidth: ndi.Bandwidth.Lowest,
        allowVideoFields: false,
        name: 'C-Lux'
      });
    } catch (err) {
      throw new HttpError(502, `Could not open "${source.name}": ${describe(err)}`);
    }

    // The pattern may have moved on to another source, or none, while this one opened.
    if (this.wanted !== name) {
      opened.destroy();
      return;
    }

    this.receiver = opened;
    this.error = null;
    this.lutKey = '';

    // Between real frames, re-publish the last strip so a low- or uneven-rate sender
    // isn't mistaken for a stopped capture and faded to black. Bounded by the source
    // still being connected and its video not having been wedged for HOLD_MAX_MS, so a
    // real disconnect still fades the ring out.
    this.holdTimer = setInterval(() => {
      if (
        this.stripWidth > 0 &&
        opened.connections() > 0 &&
        Date.now() - this.lastVideoAt < HOLD_MAX_MS
      ) {
        const { stripWidth } = this;
        setVideoStrip(this.feed, stripWidth, this.strip.slice(0, stripWidth * 3), 'ndi');
        if (DEBUG) dbg.holds++;
      }
    }, HOLD_REFRESH_MS);

    void this.pump(opened, this.generation);
  }
}

// What a Video pattern asks its receiver for.
export interface NdiRequest {
  source: string;
  sampling: number;
  geometry: VideoGeometry;
}

export interface NdiPreview {
  width: number;
  height: number;
  rgb: Uint8Array;
  // The strip published from the same frame, so the panel's strip readout matches the
  // preview it is drawn under.
  strip: Uint8Array;
}

// One receiver per Video pattern, keyed by the pattern's name like its feed.
const receivers = new Map<string, FeedReceiver>();

// Bring the receivers in line with what the patterns ask for: one per pattern in
// `requests`, any other closed. Called every tick, so it only acts on a change.
export function syncNdi(requests: ReadonlyMap<string, NdiRequest>): void {
  for (const [feed, receiver] of receivers) {
    if (requests.has(feed)) continue;
    receiver.close();
    receivers.delete(feed);
  }
  for (const [feed, request] of requests) {
    let receiver = receivers.get(feed);
    if (receiver === undefined) {
      receiver = new FeedReceiver(feed);
      receivers.set(feed, receiver);
    }
    receiver.sync(request);
  }
}

// The state of the receiver feeding a pattern; idle when the pattern wants no stream.
export function ndiStatus(feed: string): NdiStatus {
  return (
    receivers.get(feed)?.status() ?? {
      supported: unavailable === null,
      reason: unavailable,
      running: false,
      source: null,
      connections: 0,
      error: null
    }
  );
}

export function ndiPreview(feed: string): NdiPreview | null {
  return receivers.get(feed)?.takePreview() ?? null;
}

// Release the receivers and the finder so the process can exit cleanly.
export function stopNdi(): void {
  syncNdi(new Map());
  finder?.destroy();
  finder = null;
}
