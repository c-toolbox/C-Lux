import {
  DEFAULT_VIDEO_GEOMETRY,
  VIDEO_INPUT_CAMERA,
  VIDEO_INPUT_NDI,
  VIDEO_INPUT_SCREEN,
  VIDEO_SAMPLING_FISHEYE,
  VIDEO_SAMPLING_STRIP,
  type VideoCaptureSettings,
  type VideoStrip,
  videoStrip
} from '../video.ts';

import {
  NON_NEGATIVE,
  type NumberRange,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE,
  UNIT
} from './pattern.ts';

// Exported so the browser can tell whether a capture panel needs to be offered.
export const VIDEO_TYPE = 'Video';

const FISHEYE = { sampling: [VIDEO_SAMPLING_FISHEYE] };
const STRIP = { sampling: [VIDEO_SAMPLING_STRIP] };

// Lets the ring reach a little past the frame's shorter side, into the corners.
const RADIUS: NumberRange = { min: 0, max: 1.4 };

// A usable strip band is only a few percent of the frame, but never empty.
const STRIP_HEIGHT: NumberRange = { min: 0.005, max: 1 };

const FIT_SMOOTH = 0;
const FIT_SHARP = 1;

const DIRECTION_CW = 1;
const DIRECTION_CCW = -1;

// Seconds the layer takes to fade in once frames arrive and back out when the feed goes
// stale. Cutting straight to black on a dropped connection reads as a glitch.
const FADE_SECONDS = 0.4;

// The longest temporal average `smoothing` can ask for, in seconds.
const MAX_SMOOTHING_SECONDS = 0.5;

// Rec. 709 luma weights, used to pivot colors around their brightness when saturating.
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

export type VideoProps = PatternBaseProps & {
  offset: number;
  direction: number;
  fit: number;
  smoothing: number;
  saturation: number;
  gamma: number;
  input?: number;
  ndiSource?: string;
  sampling?: number;
  centerX?: number;
  centerY?: number;
  radius?: number;
  ringWidth?: number;
  rotation?: number;
  stripY?: number;
  stripHeight?: number;
};

export type VideoParameters = ReturnType<VideoPattern['parameters']>;

// What a Video pattern asks to be captured, read from its serialized parameters.
export function videoCaptureOf(params: VideoParameters): VideoCaptureSettings {
  const { input, ndiSource, sampling } = params;
  const { centerX, centerY, radius, ringWidth, rotation, stripY, stripHeight } = params;
  return {
    input,
    ndiSource,
    sampling,
    geometry: { centerX, centerY, radius, ringWidth, rotation, stripY, stripHeight }
  };
}

const clampByte = (value: number) =>
  value < 0 ? 0 : value > 255 ? 255 : Math.round(value);

// Maps the strip a capture client streams to `POST /api/patterns/:name/video` (or the
// server's NDI receiver samples) onto the ring. Each pattern has its own feed, keyed by
// its name. The capture settings stored here say where the feed
// comes from and which part of the frame becomes the strip; the browser's capture panel
// and the NDI receiver read them, the rendering below only places the resulting row of
// colors.
export class VideoPattern extends Pattern {
  static readonly Type = VIDEO_TYPE;
  static readonly DisplayName = 'Video';
  static readonly Fields = {
    input: {
      kind: 'select',
      label: 'Source',
      default: VIDEO_INPUT_SCREEN,
      row: 0,
      hint: 'Camera and screen are captured by a browser tab, NDI by the server.',
      options: [
        { value: VIDEO_INPUT_CAMERA, label: 'Camera' },
        { value: VIDEO_INPUT_SCREEN, label: 'Screen or window' },
        { value: VIDEO_INPUT_NDI, label: 'NDI stream' }
      ]
    },
    sampling: {
      kind: 'select',
      label: 'Sampling',
      default: VIDEO_SAMPLING_FISHEYE,
      row: 0,
      hint: 'Aim it by eye against the preview below.',
      options: [
        { value: VIDEO_SAMPLING_STRIP, label: 'Strip' },
        { value: VIDEO_SAMPLING_FISHEYE, label: 'Fisheye rim' }
      ]
    },
    ndiSource: {
      kind: 'text',
      label: 'NDI source',
      default: '',
      maxLength: 256,
      hint: 'The sender name, as the capture panel lists it.',
      visibleWhen: { input: [VIDEO_INPUT_NDI] }
    },
    centerX: {
      kind: 'number',
      label: 'Center X',
      default: DEFAULT_VIDEO_GEOMETRY.centerX,
      step: 0.001,
      row: 1,
      visibleWhen: FISHEYE,
      ...UNIT
    },
    centerY: {
      kind: 'number',
      label: 'Center Y',
      default: DEFAULT_VIDEO_GEOMETRY.centerY,
      step: 0.001,
      row: 1,
      visibleWhen: FISHEYE,
      ...UNIT
    },
    radius: {
      kind: 'number',
      label: 'Radius',
      default: DEFAULT_VIDEO_GEOMETRY.radius,
      step: 0.001,
      row: 2,
      hint: "As a fraction of half the frame's shorter side.",
      visibleWhen: FISHEYE,
      ...RADIUS
    },
    ringWidth: {
      kind: 'number',
      label: 'Ring width',
      default: DEFAULT_VIDEO_GEOMETRY.ringWidth,
      step: 0.001,
      row: 2,
      hint: 'As a fraction of the radius.',
      visibleWhen: FISHEYE,
      ...UNIT
    },
    rotation: {
      kind: 'number',
      label: 'Rim rotation',
      default: DEFAULT_VIDEO_GEOMETRY.rotation,
      step: 0.001,
      hint: 'Where the first light reads from, as a fraction of a turn from the top.',
      visibleWhen: FISHEYE,
      ...UNIT
    },
    stripY: {
      kind: 'number',
      label: 'Strip position',
      default: DEFAULT_VIDEO_GEOMETRY.stripY,
      step: 0.001,
      row: 3,
      visibleWhen: STRIP,
      ...UNIT
    },
    stripHeight: {
      kind: 'number',
      label: 'Strip height',
      default: DEFAULT_VIDEO_GEOMETRY.stripHeight,
      step: 0.005,
      row: 3,
      visibleWhen: STRIP,
      ...STRIP_HEIGHT
    },
    offset: {
      kind: 'number',
      label: 'Rotation',
      default: 0,
      step: 0.01,
      row: 4,
      hint: 'Fraction of the ring to turn the strip by, to line it up with the room.',
      ...UNIT
    },
    direction: {
      kind: 'select',
      label: 'Direction',
      default: DIRECTION_CW,
      row: 4,
      options: [
        { value: DIRECTION_CW, label: 'Clockwise' },
        { value: DIRECTION_CCW, label: 'Counter-clockwise' }
      ]
    },
    fit: {
      kind: 'select',
      label: 'Fit',
      default: FIT_SMOOTH,
      row: 5,
      options: [
        { value: FIT_SMOOTH, label: 'Smooth' },
        { value: FIT_SHARP, label: 'Sharp' }
      ]
    },
    smoothing: {
      kind: 'number',
      label: 'Smoothing',
      default: 0.2,
      step: 0.05,
      row: 5,
      hint: 'Averages over time; steadies a noisy feed at the cost of response.',
      ...UNIT
    },
    saturation: {
      kind: 'number',
      label: 'Saturation',
      default: 1.2,
      step: 0.1,
      row: 6,
      ...NON_NEGATIVE
    },
    gamma: {
      kind: 'number',
      label: 'Gamma',
      default: 1,
      step: 0.1,
      row: 6,
      hint: 'Above 1 deepens the darks, below 1 lifts them.',
      ...POSITIVE
    }
  } satisfies PatternSchema;

  offset!: number;
  direction!: number;
  fit!: number;
  smoothing!: number;
  saturation!: number;
  gamma!: number;
  // Defaulted rather than required so scenes saved before these existed still load.
  input: number = VideoPattern.Fields.input.default;
  ndiSource: string = VideoPattern.Fields.ndiSource.default;
  sampling: number = VideoPattern.Fields.sampling.default;
  centerX: number = DEFAULT_VIDEO_GEOMETRY.centerX;
  centerY: number = DEFAULT_VIDEO_GEOMETRY.centerY;
  radius: number = DEFAULT_VIDEO_GEOMETRY.radius;
  ringWidth: number = DEFAULT_VIDEO_GEOMETRY.ringWidth;
  rotation: number = DEFAULT_VIDEO_GEOMETRY.rotation;
  stripY: number = DEFAULT_VIDEO_GEOMETRY.stripY;
  stripHeight: number = DEFAULT_VIDEO_GEOMETRY.stripHeight;

  // Rises to 1 while frames arrive and falls back once the feed goes stale.
  private presence = 0;

  // The freshly sampled colors the visible state eases towards, as [r, g, b, ...].
  private target: number[] = new Array<number>(this.state.length * 3).fill(0);

  // Gamma as a lookup table rather than a pow() per light per channel per frame.
  private gammaLut = new Uint8Array(256);

  constructor(props: VideoProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof VideoPattern.Type;
    input: number;
    ndiSource: string;
    sampling: number;
    centerX: number;
    centerY: number;
    radius: number;
    ringWidth: number;
    rotation: number;
    stripY: number;
    stripHeight: number;
    offset: number;
    direction: number;
    fit: number;
    smoothing: number;
    saturation: number;
    gamma: number;
  } {
    return {
      name: this.name,
      type: VideoPattern.Type,
      input: this.input,
      ndiSource: this.ndiSource,
      sampling: this.sampling,
      centerX: this.centerX,
      centerY: this.centerY,
      radius: this.radius,
      ringWidth: this.ringWidth,
      rotation: this.rotation,
      stripY: this.stripY,
      stripHeight: this.stripHeight,
      offset: this.offset,
      direction: this.direction,
      fit: this.fit,
      smoothing: this.smoothing,
      saturation: this.saturation,
      gamma: this.gamma
    };
  }

  set({
    input,
    ndiSource,
    sampling,
    centerX,
    centerY,
    radius,
    ringWidth,
    rotation,
    stripY,
    stripHeight,
    offset,
    direction,
    fit,
    smoothing,
    saturation,
    gamma
  }: Partial<VideoProps>) {
    this.input = input ?? this.input;
    this.ndiSource = ndiSource ?? this.ndiSource;
    this.sampling = sampling ?? this.sampling;
    this.centerX = centerX ?? this.centerX;
    this.centerY = centerY ?? this.centerY;
    this.radius = radius ?? this.radius;
    this.ringWidth = ringWidth ?? this.ringWidth;
    this.rotation = rotation ?? this.rotation;
    this.stripY = stripY ?? this.stripY;
    this.stripHeight = stripHeight ?? this.stripHeight;
    this.offset = offset ?? this.offset;
    this.direction = direction ?? this.direction;
    this.fit = fit ?? this.fit;
    this.smoothing = smoothing ?? this.smoothing;
    this.saturation = saturation ?? this.saturation;
    this.gamma = gamma ?? this.gamma;

    for (let i = 0; i < 256; i++) {
      this.gammaLut[i] = clampByte(255 * Math.pow(i / 255, this.gamma));
    }
  }

  tick(dt: number) {
    const strip = videoStrip(this.name);
    if (strip !== null) this.resample(strip);

    const step = dt / FADE_SECONDS;
    const goal = strip === null ? 0 : 1;
    this.presence =
      this.presence < goal
        ? Math.min(goal, this.presence + step)
        : Math.max(goal, this.presence - step);

    // Exponential moving average, so `smoothing` names a window rather than a rate and
    // behaves the same whatever the tick rate is.
    const tau = this.smoothing * MAX_SMOOTHING_SECONDS;
    const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;

    for (let i = 0; i < this.state.length; i++) {
      const light = this.state[i];
      const src = i * 3;
      light.r += (this.target[src] - light.r) * k;
      light.g += (this.target[src + 1] - light.g) * k;
      light.b += (this.target[src + 2] - light.b) * k;
      light.a = this.presence;
    }
  }

  // Place the strip on the ring and apply the look controls. When the strip is exactly
  // as wide as the ring and nothing is rotated, both fits land on one pixel per light.
  private resample({ width, rgb }: VideoStrip): void {
    const n = this.state.length;

    for (let i = 0; i < n; i++) {
      const along = this.direction === DIRECTION_CCW ? (n - i) % n : i;
      const turn = along / n + this.offset;
      const x = (turn - Math.floor(turn)) * width;
      const low = Math.floor(x) % width;

      let r: number;
      let g: number;
      let b: number;
      if (this.fit === FIT_SHARP) {
        const s = low * 3;
        r = rgb[s];
        g = rgb[s + 1];
        b = rgb[s + 2];
      } else {
        const high = (low + 1) % width;
        const f = x - Math.floor(x);
        const a = low * 3;
        const c = high * 3;
        r = rgb[a] + (rgb[c] - rgb[a]) * f;
        g = rgb[a + 1] + (rgb[c + 1] - rgb[a + 1]) * f;
        b = rgb[a + 2] + (rgb[c + 2] - rgb[a + 2]) * f;
      }

      const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      const dst = i * 3;
      this.target[dst] = this.gammaLut[clampByte(luma + (r - luma) * this.saturation)];
      this.target[dst + 1] =
        this.gammaLut[clampByte(luma + (g - luma) * this.saturation)];
      this.target[dst + 2] =
        this.gammaLut[clampByte(luma + (b - luma) * this.saturation)];
    }
  }
}
