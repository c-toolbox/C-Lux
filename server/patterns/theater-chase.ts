import { type Color, Pattern, type PatternBaseProps } from './pattern.ts';

export type TheaterChaseProps = PatternBaseProps &
  Color & {
    spacing: number;
    speed: number;
  };

export class TheaterChasePattern extends Pattern {
  static readonly Type = 'TheaterChase';
  static readonly DisplayName = 'Theater Chase';

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

  advance(dt: number) {
    this.remainder += this.speed * dt;
    const steps = Math.trunc(this.remainder);
    if (steps !== 0) {
      this.remainder -= steps;
      this.offset += steps;
      this.render();
    }
  }

  private render() {
    const gap = Math.max(1, Math.round(this.spacing));
    for (let i = 0; i < this.state.length; i++) {
      const lit = (((i + this.offset) % gap) + gap) % gap === 0;
      this.state[i] = { r: this.r, g: this.g, b: this.b, a: lit ? 1 : 0 };
    }
  }
}
