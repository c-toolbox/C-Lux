import {
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE,
  UNIT
} from './pattern.ts';

export type PulseProps = PatternBaseProps &
  Color & {
    period: number;
    min: number;
    max: number;
  };

// Substituted for a non-positive period (only reachable from hand-edited storage) so the
// stored value always matches the one the animation runs on.
const FALLBACK_PERIOD = 1;

export class PulsePattern extends Pattern {
  static readonly Type = 'Pulse';
  static readonly DisplayName = 'Pulse';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color', default: { r: 77, g: 171, b: 247 } },
    period: { kind: 'number', label: 'Period (s)', default: 3, step: 0.5, ...POSITIVE },
    min: { kind: 'number', label: 'Min', default: 0, step: 0.05, row: 0, ...UNIT },
    max: { kind: 'number', label: 'Max', default: 1, step: 0.05, row: 0, ...UNIT }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  period!: number;
  min!: number;
  max!: number;

  // Elapsed time driving the breathing oscillation, in seconds.
  private phase = 0;

  constructor(props: PulseProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof PulsePattern.Type;
    color: Color;
    period: number;
    min: number;
    max: number;
  } {
    return {
      name: this.name,
      type: PulsePattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      period: this.period,
      min: this.min,
      max: this.max
    };
  }

  set({ r, g, b, period, min, max }: Partial<PulseProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    const nextPeriod = period ?? this.period;
    this.period = nextPeriod > 0 ? nextPeriod : FALLBACK_PERIOD;
    this.min = min ?? this.min;
    this.max = max ?? this.max;
    this.render();
  }

  tick(dt: number) {
    this.phase += dt;
    this.render();
  }

  private render() {
    const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * this.phase) / this.period);
    const a = this.min + (this.max - this.min) * wave;
    for (let i = 0; i < this.state.length; i++) {
      this.state[i] = { r: this.r, g: this.g, b: this.b, a };
    }
  }
}
