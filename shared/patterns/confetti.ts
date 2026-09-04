import {
  hsvToRgb,
  NON_NEGATIVE,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  UNIT
} from './pattern.ts';

export type ConfettiProps = PatternBaseProps & {
  // Share of the ring igniting per second (1 = as many pops as there are lights), the
  // fade rate, and the hue window each pop draws its color from, in degrees.
  density: number;
  decay: number;
  hue: number;
  hueRange: number;
  saturation: number;
};

const DEGREES = { min: 0, max: 360 };

export class ConfettiPattern extends Pattern {
  static readonly Type = 'Confetti';
  static readonly DisplayName = 'Confetti';
  static readonly Fields = {
    density: {
      kind: 'number',
      label: 'Density (ring/s)',
      default: 0.3,
      step: 0.05,
      row: 0,
      ...NON_NEGATIVE
    },
    decay: {
      kind: 'number',
      label: 'Decay',
      default: 2,
      step: 0.5,
      row: 0,
      ...NON_NEGATIVE
    },
    hue: { kind: 'number', label: 'Hue (°)', default: 0, step: 10, row: 1, ...DEGREES },
    hueRange: {
      kind: 'number',
      label: 'Hue range (°)',
      default: 360,
      step: 10,
      row: 1,
      hint: 'The full 360° gives every color; a narrow window keeps to one palette.',
      ...DEGREES
    },
    saturation: {
      kind: 'number',
      label: 'Saturation',
      default: 1,
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

  // Per-light brightness in [0, 1] and the hue that light popped with.
  private intensities: number[] = Array.from({ length: this.state.length }, () => 0);
  private hues: number[] = Array.from({ length: this.state.length }, () => 0);

  constructor(props: ConfettiProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof ConfettiPattern.Type;
    density: number;
    decay: number;
    hue: number;
    hueRange: number;
    saturation: number;
  } {
    return {
      name: this.name,
      type: ConfettiPattern.Type,
      density: this.density,
      decay: this.decay,
      hue: this.hue,
      hueRange: this.hueRange,
      saturation: this.saturation
    };
  }

  set({ density, decay, hue, hueRange, saturation }: Partial<ConfettiProps>) {
    this.density = density ?? this.density;
    this.decay = decay ?? this.decay;
    this.hue = hue ?? this.hue;
    this.hueRange = hueRange ?? this.hueRange;
    this.saturation = saturation ?? this.saturation;
    this.render();
  }

  tick(dt: number) {
    const n = this.state.length;

    const factor = Math.exp(-this.decay * dt);
    for (let i = 0; i < n; i++) {
      this.intensities[i] *= factor;
    }

    // `density` is the expected share of the ring popping per second.
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

  private render() {
    for (let i = 0; i < this.state.length; i++) {
      const { r, g, b } = hsvToRgb(this.hues[i] ?? 0, this.saturation, 1);
      this.state[i] = { r, g, b, a: this.intensities[i] ?? 0 };
    }
  }
}
