import {
  hsvToRgb,
  NON_NEGATIVE,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  UNIT
} from './pattern.ts';

export type SparkleProps = PatternBaseProps & {
  // Share of the ring igniting per second (1 = as many sparkles as there are lights), the
  // fade rate, and the hue window each sparkle draws its color from, in degrees.
  density: number;
  decay: number;
  hue: number;
  hueRange: number;
  saturation: number;
};

const DEGREES = { min: 0, max: 360 };

export class SparklePattern extends Pattern {
  static readonly Type = 'Sparkle';
  static readonly DisplayName = 'Sparkle';
  static readonly Fields = {
    density: {
      kind: 'number',
      label: 'Density (ring/s)',
      default: 0.14,
      step: 0.01,
      row: 0,
      ...NON_NEGATIVE
    },
    decay: {
      kind: 'number',
      label: 'Decay',
      default: 3,
      step: 0.5,
      row: 0,
      ...NON_NEGATIVE
    },
    hue: { kind: 'number', label: 'Hue (°)', default: 0, step: 10, row: 1, ...DEGREES },
    hueRange: {
      kind: 'number',
      label: 'Hue range (°)',
      default: 0,
      step: 10,
      row: 1,
      hint: 'The full 360° gives every color; a narrow window keeps to one palette.',
      ...DEGREES
    },
    saturation: {
      kind: 'number',
      label: 'Saturation',
      default: 0,
      step: 0.05,
      row: 1,
      ...UNIT
    }
  } satisfies PatternSchema;

  density!: number;
  decay!: number;
  hue!: number;
  hueRange!: number;
  saturation!: number;

  // Per-light brightness in [0, 1] and the hue that light ignited with.
  private intensities: number[] = Array.from({ length: this.state.length }, () => 0);
  private hues: number[] = Array.from({ length: this.state.length }, () => 0);

  constructor(props: SparkleProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof SparklePattern.Type;
    density: number;
    decay: number;
    hue: number;
    hueRange: number;
    saturation: number;
  } {
    return {
      name: this.name,
      type: SparklePattern.Type,
      density: this.density,
      decay: this.decay,
      hue: this.hue,
      hueRange: this.hueRange,
      saturation: this.saturation
    };
  }

  set({ density, decay, hue, hueRange, saturation }: Partial<SparkleProps>) {
    this.density = density ?? this.density;
    this.decay = decay ?? this.decay;
    this.hue = hue ?? this.hue;
    this.hueRange = hueRange ?? this.hueRange;
    this.saturation = saturation ?? this.saturation;

    this.render();
  }

  tick(dt: number) {
    const n = this.state.length;

    // Fade every active sparkle toward zero.
    const factor = Math.exp(-this.decay * dt);
    for (let i = 0; i < n; i++) {
      this.intensities[i] *= factor;
    }

    // Ignite new sparkles; `density` is the expected share of the ring spawned per second.
    let expected = this.density * n * dt;
    while (expected > 0) {
      if (expected < 1 && Math.random() >= expected) break;
      const i = Math.floor(Math.random() * n);
      this.intensities[i] = 1;
      this.hues[i] = this.hue + Math.random() * this.hueRange;
      expected -= 1;
    }

    this.render();
  }

  // Paint the current sparkle intensities onto the light state.
  private render() {
    for (let i = 0; i < this.state.length; i++) {
      const { r, g, b } = hsvToRgb(this.hues[i] ?? 0, this.saturation, 1);
      this.state[i] = { r, g, b, a: this.intensities[i] ?? 0 };
    }
  }
}
