import {
  type Color,
  hsvToRgb,
  NON_NEGATIVE,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  rgbToHsv
} from './pattern.ts';

export type SparkleProps = PatternBaseProps &
  Color & {
    // Share of the ring igniting per second (1 = as many sparkles as there are lights),
    // the fade-in time in seconds (0 = instant), the fade rate, and the hue window,
    // centered on the color's hue, each sparkle draws its color from, in degrees.
    density: number;
    attack: number;
    decay: number;
    hueRange: number;
  };

const DEGREES = { min: 0, max: 360 };

export class SparklePattern extends Pattern {
  static readonly Type = 'Sparkle';
  static readonly DisplayName = 'Sparkle';
  static readonly Fields = {
    color: {
      kind: 'color',
      label: 'Color',
      default: { r: 255, g: 255, b: 255 },
      hint: 'Color of the sparkles; the hue range spreads them around its hue.'
    },
    density: {
      kind: 'number',
      label: 'Density (ring/s)',
      hint: 'Sparkles started per second, as a share of the lights in the ring.',
      default: 0.14,
      step: 0.01,
      row: 0,
      ...NON_NEGATIVE
    },
    attack: {
      kind: 'number',
      label: 'Fade in (s)',
      default: 0,
      step: 0.05,
      row: 0,
      hint: 'Time a sparkle takes to reach full brightness; 0 lights it instantly.',
      ...NON_NEGATIVE
    },
    decay: {
      kind: 'number',
      label: 'Decay',
      hint: 'How fast a sparkle fades; higher is shorter.',
      default: 3,
      step: 0.5,
      row: 0,
      ...NON_NEGATIVE
    },
    hueRange: {
      kind: 'number',
      label: 'Hue range (°)',
      default: 0,
      step: 10,
      hint: 'The full 360° gives every color; a narrow window keeps to one palette.',
      ...DEGREES
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  a = 1;
  density!: number;
  // Initialized so patterns saved before the field existed still load.
  attack: number = SparklePattern.Fields.attack.default;
  decay!: number;
  hueRange!: number;

  // Per-light brightness in [0, 1] and the hue offset from the color that light ignited
  // with.
  private intensities: number[] = Array.from({ length: this.state.length }, () => 0);
  private hueOffsets: number[] = Array.from({ length: this.state.length }, () => 0);
  // Whether each light is still fading in rather than decaying.
  private rising: boolean[] = Array.from({ length: this.state.length }, () => false);

  constructor(props: SparkleProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof SparklePattern.Type;
    color: Color;
    density: number;
    attack: number;
    decay: number;
    hueRange: number;
  } {
    return {
      name: this.name,
      type: SparklePattern.Type,
      color: { r: this.r, g: this.g, b: this.b, a: this.a },
      density: this.density,
      attack: this.attack,
      decay: this.decay,
      hueRange: this.hueRange
    };
  }

  set({ r, g, b, a, density, attack, decay, hueRange }: Partial<SparkleProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.a = a ?? this.a;
    this.density = density ?? this.density;
    this.attack = attack ?? this.attack;
    this.decay = decay ?? this.decay;
    this.hueRange = hueRange ?? this.hueRange;

    this.render();
  }

  tick(dt: number) {
    const n = this.state.length;

    // Ramp rising sparkles up to full, then fade them toward zero.
    const factor = Math.exp(-this.decay * dt);
    const step = this.attack > 0 ? dt / this.attack : Infinity;
    for (let i = 0; i < n; i++) {
      if (this.rising[i]) {
        this.intensities[i] = Math.min(1, this.intensities[i] + step);
        if (this.intensities[i] >= 1) this.rising[i] = false;
      } else {
        this.intensities[i] *= factor;
      }
    }

    // Ignite new sparkles; `density` is the expected share of the ring spawned per second.
    let expected = this.density * n * dt;
    while (expected > 0) {
      if (expected < 1 && Math.random() >= expected) break;
      const i = Math.floor(Math.random() * n);
      // Rise from the current brightness so a re-ignited light doesn't dip.
      if (this.attack > 0) this.rising[i] = true;
      else this.intensities[i] = 1;
      this.hueOffsets[i] = (Math.random() - 0.5) * this.hueRange;
      expected -= 1;
    }

    this.render();
  }

  // Paint the current sparkle intensities onto the light state.
  private render() {
    const { h, s, v } = rgbToHsv(this);
    for (let i = 0; i < this.state.length; i++) {
      const offset = this.hueOffsets[i] ?? 0;
      const { r, g, b } =
        offset === 0 ? { r: this.r, g: this.g, b: this.b } : hsvToRgb(h + offset, s, v);
      this.state[i] = { r, g, b, a: (this.intensities[i] ?? 0) * this.a };
    }
  }
}
