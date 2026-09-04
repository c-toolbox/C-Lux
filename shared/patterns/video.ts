import { type VideoStrip, videoStrip } from '../video.ts';

import {
  NON_NEGATIVE,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE,
  UNIT
} from './pattern.ts';

// Exported so the browser can tell whether a capture panel needs to be offered.
export const VIDEO_TYPE = 'Video';

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
};

const clampByte = (value: number) =>
  value < 0 ? 0 : value > 255 ? 255 : Math.round(value);

// Maps the strip a capture client streams to `POST /api/video` onto the ring. The client
// decides what the strip means — the pixel columns of a wide video, or the rim of a
// fisheye feed — so everything here is about placing an existing row of colors.
export class VideoPattern extends Pattern {
  static readonly Type = VIDEO_TYPE;
  static readonly DisplayName = 'Video';
  static readonly Fields = {
    offset: {
      kind: 'number',
      label: 'Rotation',
      default: 0,
      step: 0.01,
      row: 0,
      hint: 'Fraction of the ring to turn the strip by, to line it up with the room.',
      ...UNIT
    },
    direction: {
      kind: 'select',
      label: 'Direction',
      default: DIRECTION_CW,
      row: 0,
      options: [
        { value: DIRECTION_CW, label: 'Clockwise' },
        { value: DIRECTION_CCW, label: 'Counter-clockwise' }
      ]
    },
    fit: {
      kind: 'select',
      label: 'Fit',
      default: FIT_SMOOTH,
      row: 1,
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
      row: 1,
      hint: 'Averages over time; steadies a noisy feed at the cost of response.',
      ...UNIT
    },
    saturation: {
      kind: 'number',
      label: 'Saturation',
      default: 1.2,
      step: 0.1,
      row: 2,
      ...NON_NEGATIVE
    },
    gamma: {
      kind: 'number',
      label: 'Gamma',
      default: 1,
      step: 0.1,
      row: 2,
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
      offset: this.offset,
      direction: this.direction,
      fit: this.fit,
      smoothing: this.smoothing,
      saturation: this.saturation,
      gamma: this.gamma
    };
  }

  set({ offset, direction, fit, smoothing, saturation, gamma }: Partial<VideoProps>) {
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
    const strip = videoStrip();
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
