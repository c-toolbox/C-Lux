import { type Color, Pattern, type PatternBaseProps } from './pattern.ts';

export type CometProps = PatternBaseProps &
  Color & {
    speed: number;
    tail: number;
    direction: number;
    start: number;
    end: number;
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

  // Light indices the head travels between. Equal values (the default for patterns stored
  // before these existed) mean the comet loops around the whole ring.
  start = 0;
  end = 0;

  // Distance travelled from `start` along the travel direction, in lights.
  private progress = 0;

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
    start: number;
    end: number;
  } {
    return {
      name: this.name,
      type: CometPattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      speed: this.speed,
      tail: this.tail,
      direction: this.direction,
      start: this.start,
      end: this.end
    };
  }

  set({ r, g, b, speed, tail, direction, start, end }: Partial<CometProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.speed = speed ?? this.speed;
    this.tail = tail ?? this.tail;
    this.direction = direction ?? this.direction;
    this.start = start ?? this.start;
    this.end = end ?? this.end;
    this.render();
  }

  advance(dt: number) {
    const n = this.state.length;
    if (n === 0) return;
    this.progress = mod(this.progress + this.speed * dt, this.cycle());
    this.render();
  }

  // Length of the travelled arc in lights: `start` to `end` measured in the travel
  // direction, or the whole ring when the two coincide.
  private span(): number {
    const n = this.state.length;
    const distance =
      this.direction >= 0 ? mod(this.end - this.start, n) : mod(this.start - this.end, n);
    return distance === 0 ? n : distance;
  }

  // Distance travelled before the head restarts. A bounded arc runs one light past its
  // span so the head actually reaches `end`; a full loop wraps back onto its start.
  private cycle(): number {
    const span = this.span();
    return span < this.state.length ? span + 1 : span;
  }

  private render() {
    const n = this.state.length;
    const dir = this.direction >= 0 ? 1 : -1;
    const tail = this.tail > 0 ? this.tail : 0.0001;
    const span = this.span();
    for (let i = 0; i < n; i++) {
      // Where light i sits along the arc, measured from `start` in the travel direction.
      const offset = dir > 0 ? mod(i - this.start, n) : mod(this.start - i, n);
      let behind = this.progress - offset;
      // Over a full loop the tail keeps trailing across the seam; on a shorter arc it is
      // cut off at `start` instead of reappearing at the far end.
      if (behind < 0 && span >= n) behind += n;
      const a = offset > span || behind < 0 ? 0 : Math.exp(-behind / tail);
      this.state[i] = { r: this.r, g: this.g, b: this.b, a };
    }
  }
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}
