import { AUDIO_BANDS, audioFrame } from '../audio.ts';

import {
  hsvToRgb,
  NON_NEGATIVE,
  type NumberRange,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  UNIT
} from './pattern.ts';

// Exported so the browser can tell whether a capture panel needs to be offered.
export const AUDIO_TYPE = 'Audio';

export const AUDIO_MODE_SPECTRUM = 0;
export const AUDIO_MODE_VU = 1;

const DEGREES: NumberRange = { min: 0, max: 360 };
const SIGNED_DEGREES: NumberRange = { min: -360, max: 360 };

export type AudioProps = PatternBaseProps & {
  mode: number;
  gain: number;
  floor: number;
  decay: number;
  hue: number;
  hueSpan: number;
};

const clampUnit = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

// Visualizes the audio a capture client streams to `POST /api/audio`. Both modes run
// outward from the center of the ring: the spectrum puts bass at the center and treble
// at the ends, the VU meter fills toward the ends with overall loudness.
export class AudioPattern extends Pattern {
  static readonly Type = AUDIO_TYPE;
  static readonly DisplayName = 'Audio';
  static readonly Fields = {
    mode: {
      kind: 'select',
      label: 'Mode',
      default: AUDIO_MODE_SPECTRUM,
      row: 0,
      options: [
        { value: AUDIO_MODE_SPECTRUM, label: 'Spectrum' },
        { value: AUDIO_MODE_VU, label: 'VU meter' }
      ]
    },
    gain: {
      kind: 'number',
      label: 'Gain',
      default: 1,
      step: 0.1,
      row: 0,
      ...NON_NEGATIVE
    },
    floor: {
      kind: 'number',
      label: 'Noise gate',
      default: 0.05,
      step: 0.01,
      row: 1,
      ...UNIT
    },
    decay: {
      kind: 'number',
      label: 'Decay',
      default: 6,
      step: 0.5,
      row: 1,
      hint: 'How fast a peak falls back; 0 holds it.',
      ...NON_NEGATIVE
    },
    hue: {
      kind: 'number',
      label: 'Base hue',
      default: 0,
      step: 10,
      row: 2,
      ...DEGREES
    },
    hueSpan: {
      kind: 'number',
      label: 'Hue span',
      default: 300,
      step: 10,
      row: 2,
      ...SIGNED_DEGREES
    }
  } satisfies PatternSchema;

  mode!: number;
  gain!: number;
  floor!: number;
  decay!: number;
  hue!: number;
  hueSpan!: number;

  // Peak-following band magnitudes in [0, 1]: they jump straight to a new peak and then
  // fall off at `decay`, so the lights track transients without flickering.
  private levels: number[] = new Array<number>(AUDIO_BANDS).fill(0);
  private vu = 0;

  constructor(props: AudioProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof AudioPattern.Type;
    mode: number;
    gain: number;
    floor: number;
    decay: number;
    hue: number;
    hueSpan: number;
  } {
    return {
      name: this.name,
      type: AudioPattern.Type,
      mode: this.mode,
      gain: this.gain,
      floor: this.floor,
      decay: this.decay,
      hue: this.hue,
      hueSpan: this.hueSpan
    };
  }

  set({ mode, gain, floor, decay, hue, hueSpan }: Partial<AudioProps>) {
    this.mode = mode ?? this.mode;
    this.gain = gain ?? this.gain;
    this.floor = floor ?? this.floor;
    this.decay = decay ?? this.decay;
    this.hue = hue ?? this.hue;
    this.hueSpan = hueSpan ?? this.hueSpan;

    this.render();
  }

  advance(dt: number) {
    const frame = audioFrame();
    const falloff = Math.exp(-this.decay * dt);

    for (let i = 0; i < AUDIO_BANDS; i++) {
      this.levels[i] = Math.max(this.gate(frame.bands[i] ?? 0), this.levels[i] * falloff);
    }
    this.vu = Math.max(this.gate(frame.level), this.vu * falloff);

    this.render();
  }

  // Apply the gain and rescale so everything below the noise gate reads as silence.
  private gate(value: number): number {
    if (this.floor >= 1) return 0;
    return clampUnit((value * this.gain - this.floor) / (1 - this.floor));
  }

  private render() {
    const n = this.state.length;
    if (n === 0) return;

    // Both halves are drawn from the center outward, mirrored around the seam.
    const mid = Math.floor(n / 2);
    const reach = Math.max(mid, n - mid);
    const filled = this.vu * reach;

    for (let i = 0; i < n; i++) {
      const distance = i >= mid ? i - mid : mid - 1 - i;
      const t = reach > 1 ? distance / (reach - 1) : 0;
      const value =
        this.mode === AUDIO_MODE_VU
          ? // The partially reached light dims to feather the tip of the meter.
            clampUnit(filled - distance)
          : this.bandAt(t);

      this.state[i] = { ...hsvToRgb(this.hue + t * this.hueSpan, 1, 1), a: value };
    }
  }

  // Band magnitude at a normalized position across the spectrum, interpolated between
  // neighbouring bands so 142 lights don't show 32 hard steps.
  private bandAt(t: number): number {
    const x = t * (AUDIO_BANDS - 1);
    const index = Math.floor(x);
    const low = this.levels[index] ?? 0;
    const high = this.levels[index + 1] ?? low;
    return low + (high - low) * (x - index);
  }
}
