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

  // Base positions of the lit dots, evenly spread over the ring so that rotating them
  // wraps seamlessly. `offset` is how far they have rotated, `remainder` the sub-step
  // part of that rotation.
  private positions: Array<number> = [];
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
    this.layout();
    this.render();
  }

  tick(dt: number) {
    this.remainder += this.speed * this.state.length * dt;
    const steps = Math.trunc(this.remainder);
    if (steps !== 0) {
      this.remainder -= steps;
      const n = this.state.length;
      this.offset = (((this.offset + steps) % n) + n) % n;
      this.render();
    }
  }

  // Place the dots once. The count is derived from the spacing and the gaps between
  // consecutive dots are spread as evenly as the light count allows, so that the ring
  // closes on itself and no dot appears or disappears while rotating.
  private layout() {
    const n = this.state.length;
    const count = Math.min(n, Math.max(1, Math.round(1 / this.spacing)));
    this.positions = Array.from({ length: count }, (_, k) => Math.floor((k * n) / count));
  }

  private render() {
    for (let i = 0; i < this.state.length; i++) {
      this.state[i] = { r: this.r, g: this.g, b: this.b, a: 0 };
    }
    for (const position of this.positions) {
      this.state[(position + this.offset) % this.state.length].a = 1;
    }
  }
}
