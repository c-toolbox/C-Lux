import {
  AUDIO_BANDS,
  AUDIO_MAX_HZ,
  AUDIO_MIN_HZ,
  audioBandIndex,
  audioFrame
} from '../audio.ts';

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

const AUDIO_MODE_SPECTRUM = 0;
const AUDIO_MODE_VU = 1;

const DEGREES: NumberRange = { min: 0, max: 360 };
const SIGNED_DEGREES: NumberRange = { min: -360, max: 360 };

// Anything outside the captured range reads as silence, so the endpoints are pinned to it.
const HERTZ: NumberRange = { min: AUDIO_MIN_HZ, max: AUDIO_MAX_HZ };

export type AudioProps = PatternBaseProps & {
  mode: number;
  gain: number;
  floor: number;
  decay: number;
  hue: number;
  hueSpan: number;
  frontHz?: number;
  backHz?: number;
};

const clampUnit = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

// Visualizes the audio a capture client streams to `POST /api/audio`. Both modes run
// outward from the top of the ring: the spectrum puts bass at the top and treble at the
// bottom, the VU meter fills down both sides with overall loudness.
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
    },
    frontHz: {
      kind: 'number',
      label: 'Front frequency',
      default: AUDIO_MIN_HZ,
      step: 10,
      row: 3,
      hint: 'Frequency shown at the top of the ring.',
      ...HERTZ
    },
    backHz: {
      kind: 'number',
      label: 'Back frequency',
      default: AUDIO_MAX_HZ,
      step: 100,
      row: 3,
      hint: 'Frequency shown at the bottom of the ring.',
      ...HERTZ
    }
  } satisfies PatternSchema;

  mode!: number;
  gain!: number;
  floor!: number;
  decay!: number;
  hue!: number;
  hueSpan!: number;
  // Defaulted rather than required so scenes saved before these existed still load.
  frontHz: number = AudioPattern.Fields.frontHz.default;
  backHz: number = AudioPattern.Fields.backHz.default;

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
    frontHz: number;
    backHz: number;
  } {
    return {
      name: this.name,
      type: AudioPattern.Type,
      mode: this.mode,
      gain: this.gain,
      floor: this.floor,
      decay: this.decay,
      hue: this.hue,
      hueSpan: this.hueSpan,
      frontHz: this.frontHz,
      backHz: this.backHz
    };
  }

  set({ mode, gain, floor, decay, hue, hueSpan, frontHz, backHz }: Partial<AudioProps>) {
    this.mode = mode ?? this.mode;
    this.gain = gain ?? this.gain;
    this.floor = floor ?? this.floor;
    this.decay = decay ?? this.decay;
    this.hue = hue ?? this.hue;
    this.hueSpan = hueSpan ?? this.hueSpan;
    this.frontHz = frontHz ?? this.frontHz;
    this.backHz = backHz ?? this.backHz;

    this.render();
  }

  tick(dt: number) {
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

    // Light 0 sits at the top of the ring, so both halves are drawn from there downward,
    // mirrored around the vertical axis.
    const reach = Math.floor(n / 2) + 1;
    const filled = this.vu * reach;

    for (let i = 0; i < n; i++) {
      const distance = Math.min(i, n - i);
      const t = reach > 1 ? distance / (reach - 1) : 0;
      const value =
        this.mode === AUDIO_MODE_VU
          ? // The partially reached light dims to feather the tip of the meter.
            clampUnit(filled - distance)
          : this.bandAt(t);

      this.state[i] = { ...hsvToRgb(this.hue + t * this.hueSpan, 1, 1), a: value };
    }
  }

  // Band magnitude at a normalized position across the ring, where 0 is the front and 1
  // the back. The position is swept logarithmically between the two configured
  // frequencies and interpolated between neighbouring bands so 142 lights don't show 32
  // hard steps.
  private bandAt(t: number): number {
    const hz = this.frontHz * Math.pow(this.backHz / this.frontHz, t);
    const x = Math.max(0, Math.min(AUDIO_BANDS - 1, audioBandIndex(hz)));
    const index = Math.floor(x);
    const low = this.levels[index] ?? 0;
    const high = this.levels[index + 1] ?? low;
    return low + (high - low) * (x - index);
  }
}
