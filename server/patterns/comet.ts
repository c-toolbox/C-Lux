import { type Color, Pattern, type PatternBaseProps } from './pattern.ts';

export type CometProps = PatternBaseProps &
  Color & {
    speed: number;
    tail: number;
    direction: number;
  };

export class CometPattern extends Pattern {
  static readonly Type = 'Comet';
  static readonly DisplayName = 'Comet';

  r!: number;
  g!: number;
  b!: number;
  speed!: number;
  tail!: number;
  direction!: number;

  // Head position along the ring, in lights.
  private position = 0;

  constructor(props: CometProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof CometPattern.Type;
    color: Color;
    speed: number;
    tail: number;
    direction: number;
  } {
    return {
      name: this.name,
      type: CometPattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      speed: this.speed,
      tail: this.tail,
      direction: this.direction
    };
  }

  set({ r, g, b, speed, tail, direction }: Partial<CometProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.speed = speed ?? this.speed;
    this.tail = tail ?? this.tail;
    this.direction = direction ?? this.direction;
    this.render();
  }

  advance(dt: number) {
    const n = this.state.length;
    if (n === 0) return;
    const dir = this.direction >= 0 ? 1 : -1;
    this.position = (((this.position + this.speed * dir * dt) % n) + n) % n;
    this.render();
  }

  private render() {
    const n = this.state.length;
    const dir = this.direction >= 0 ? 1 : -1;
    const tail = this.tail > 0 ? this.tail : 0.0001;
    for (let i = 0; i < n; i++) {
      // Distance measured behind the head, opposite the travel direction.
      const d =
        dir > 0
          ? (((this.position - i) % n) + n) % n
          : (((i - this.position) % n) + n) % n;
      const a = Math.exp(-d / tail);
      this.state[i] = { r: this.r, g: this.g, b: this.b, a };
    }
  }
}
