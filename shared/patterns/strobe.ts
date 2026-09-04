import {
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE,
  UNIT
} from './pattern.ts';

export type StrobeProps = PatternBaseProps &
  Color & {
    // Flashes per second and the share of each cycle the lights stay on.
    rate: number;
    duty: number;
  };

export class StrobePattern extends Pattern {
  static readonly Type = 'Strobe';
  static readonly DisplayName = 'Strobe';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color', default: { r: 255, g: 255, b: 255 } },
    rate: {
      kind: 'number',
      label: 'Rate (flashes/s)',
      default: 8,
      step: 0.5,
      row: 0,
      ...POSITIVE
    },
    duty: {
      kind: 'number',
      label: 'Duty',
      default: 0.15,
      step: 0.05,
      row: 0,
      hint: 'Share of each cycle the lights are on; low values give sharp flashes.',
      ...UNIT
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  rate!: number;
  duty!: number;

  // Position within the current flash cycle, in [0, 1).
  private phase = 0;

  constructor(props: StrobeProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof StrobePattern.Type;
    color: Color;
    rate: number;
    duty: number;
  } {
    return {
      name: this.name,
      type: StrobePattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      rate: this.rate,
      duty: this.duty
    };
  }

  set({ r, g, b, rate, duty }: Partial<StrobeProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.rate = rate ?? this.rate;
    this.duty = duty ?? this.duty;
    this.render();
  }

  tick(dt: number) {
    this.phase = (this.phase + this.rate * dt) % 1;
    this.render();
  }

  private render() {
    const a = this.phase < this.duty ? 1 : 0;
    for (let i = 0; i < this.state.length; i++) {
      this.state[i] = { r: this.r, g: this.g, b: this.b, a };
    }
  }
}
