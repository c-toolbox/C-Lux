import {
  ANY,
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  UNIT
} from './pattern.ts';

export type CometProps = PatternBaseProps &
  Color & {
    // Fractions of the ring: tail length and the start/end positions as a share of the
    // circumference, speed in full turns per second.
    speed: number;
    tail: number;
    direction: number;
    start: number;
    end: number;
  };

export class CometPattern extends Pattern {
  static readonly Type = 'Comet';
  static readonly DisplayName = 'Comet';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color', default: { r: 255, g: 255, b: 255 } },
    speed: {
      kind: 'number',
      label: 'Speed (turns/s)',
      default: 0.1,
      step: 0.05,
      row: 0,
      ...ANY
    },
    tail: {
      kind: 'number',
      label: 'Tail (fraction)',
      default: 0.06,
      step: 0.01,
      row: 0,
      ...UNIT
    },
    direction: {
      kind: 'select',
      label: 'Direction',
      default: 1,
      options: [
        { value: 1, label: 'Forward' },
        { value: -1, label: 'Backward' }
      ]
    },
    start: {
      kind: 'number',
      label: 'Start (fraction)',
      default: 0,
      step: 0.01,
      row: 1,
      ...UNIT
    },
    end: {
      kind: 'number',
      label: 'End (fraction)',
      default: 0,
      step: 0.01,
      row: 1,
      hint: 'Same start and end loops the whole ring.',
      ...UNIT
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  speed!: number;
  tail!: number;
  direction!: number;

  // Positions on the ring the head travels between. Equal values (the default for
  // patterns stored before these existed) mean the comet loops around the whole ring.
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
    this.progress = mod(this.progress + this.speed * n * dt, this.cycle());
    this.render();
  }

  // Length of the travelled arc in lights: `start` to `end` measured in the travel
  // direction, or the whole ring when the two coincide.
  private span(): number {
    const n = this.state.length;
    const start = this.start * n;
    const end = this.end * n;
    const distance = this.direction >= 0 ? mod(end - start, n) : mod(start - end, n);
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
    const tail = this.tail > 0 ? this.tail * n : 0.0001;
    const start = this.start * n;
    const span = this.span();
    for (let i = 0; i < n; i++) {
      // Where light i sits along the arc, measured from `start` in the travel direction.
      const offset = dir > 0 ? mod(i - start, n) : mod(start - i, n);
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
