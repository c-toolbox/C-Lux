import {
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE_UNIT
} from './pattern.ts';

export type TheaterChaseProps = PatternBaseProps &
  Color & {
    // Spacing is a fraction of the ring and speed is in full turns per second.
    spacing: number;
    speed: number;
  };

export class TheaterChasePattern extends Pattern {
  static readonly Type = 'TheaterChase';
  static readonly DisplayName = 'Theater Chase';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color', default: { r: 255, g: 255, b: 255 } },
    spacing: {
      kind: 'number',
      label: 'Spacing (fraction)',
      default: 0.02,
      step: 0.01,
      row: 0,
      ...POSITIVE_UNIT
    },
    speed: {
      kind: 'number',
      label: 'Speed (turns/s)',
      default: 0.05,
      step: 0.05,
      row: 0
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  spacing!: number;
  speed!: number;

  // Step offset of the lit dots and the sub-step remainder.
  private offset = 0;
  private remainder = 0;

  constructor(props: TheaterChaseProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof TheaterChasePattern.Type;
    color: Color;
    spacing: number;
    speed: number;
  } {
    return {
      name: this.name,
      type: TheaterChasePattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      spacing: this.spacing,
      speed: this.speed
    };
  }

  set({ r, g, b, spacing, speed }: Partial<TheaterChaseProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.spacing = spacing ?? this.spacing;
    this.speed = speed ?? this.speed;
    this.render();
  }

  tick(dt: number) {
    this.remainder += this.speed * this.state.length * dt;
    const steps = Math.trunc(this.remainder);
    if (steps !== 0) {
      this.remainder -= steps;
      this.offset += steps;
      this.render();
    }
  }

  private render() {
    const gap = Math.max(1, Math.round(this.spacing * this.state.length));
    for (let i = 0; i < this.state.length; i++) {
      const lit = (((i + this.offset) % gap) + gap) % gap === 0;
      this.state[i] = { r: this.r, g: this.g, b: this.b, a: lit ? 1 : 0 };
    }
  }
}
