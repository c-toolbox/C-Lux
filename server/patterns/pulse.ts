import { type Color, Pattern, type PatternBaseProps } from './pattern.ts';

export type PulseProps = PatternBaseProps &
  Color & {
    period: number;
    min: number;
    max: number;
  };

export class PulsePattern extends Pattern {
  static readonly Type = 'Pulse';
  static readonly DisplayName = 'Pulse';

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
    this.period = period ?? this.period;
    this.min = min ?? this.min;
    this.max = max ?? this.max;
    this.render();
  }

  advance(dt: number) {
    this.phase += dt;
    this.render();
  }

  private render() {
    const p = this.period > 0 ? this.period : 1;
    const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * this.phase) / p);
    const a = this.min + (this.max - this.min) * wave;
    for (let i = 0; i < this.state.length; i++) {
      this.state[i] = { r: this.r, g: this.g, b: this.b, a };
    }
  }
}
