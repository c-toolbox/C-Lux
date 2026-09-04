import {
  type Color,
  NON_NEGATIVE,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE,
  POSITIVE_UNIT,
  UNIT
} from './pattern.ts';

export type MeteorsProps = PatternBaseProps &
  Color & {
    // Meteors launched per second, speed in full turns per second and tail length as a
    // fraction of the ring.
    rate: number;
    speed: number;
    tail: number;
    variation: number;
    direction: number;
  };

// A head travelling around the ring, trailing a tail that fades out behind it.
interface Meteor {
  position: number;
  travelled: number;
  speed: number;
  tail: number;
  direction: number;
}

export class MeteorsPattern extends Pattern {
  static readonly Type = 'Meteors';
  static readonly DisplayName = 'Meteors';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color', default: { r: 255, g: 255, b: 255 } },
    rate: {
      kind: 'number',
      label: 'Rate (per s)',
      default: 1,
      step: 0.1,
      row: 0,
      ...NON_NEGATIVE
    },
    speed: {
      kind: 'number',
      label: 'Speed (turns/s)',
      default: 0.4,
      step: 0.05,
      row: 0,
      ...POSITIVE
    },
    tail: {
      kind: 'number',
      label: 'Tail (fraction)',
      default: 0.08,
      step: 0.01,
      row: 1,
      ...POSITIVE_UNIT
    },
    variation: {
      kind: 'number',
      label: 'Variation',
      default: 0.4,
      step: 0.05,
      row: 1,
      hint: 'How much speed and tail differ from one meteor to the next.',
      ...UNIT
    },
    direction: {
      kind: 'select',
      label: 'Direction',
      default: 1,
      options: [
        { value: 1, label: 'Forward' },
        { value: -1, label: 'Backward' },
        { value: 0, label: 'Both' }
      ]
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  rate!: number;
  speed!: number;
  tail!: number;
  variation!: number;
  direction!: number;

  private meteors: Meteor[] = [];

  constructor(props: MeteorsProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof MeteorsPattern.Type;
    color: Color;
    rate: number;
    speed: number;
    tail: number;
    variation: number;
    direction: number;
  } {
    return {
      name: this.name,
      type: MeteorsPattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      rate: this.rate,
      speed: this.speed,
      tail: this.tail,
      variation: this.variation,
      direction: this.direction
    };
  }

  set({ r, g, b, rate, speed, tail, variation, direction }: Partial<MeteorsProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.rate = rate ?? this.rate;
    this.speed = speed ?? this.speed;
    this.tail = tail ?? this.tail;
    this.variation = variation ?? this.variation;
    this.direction = direction ?? this.direction;
    this.render();
  }

  tick(dt: number) {
    const n = this.state.length;

    // A meteor is retired once it has covered a full turn plus its own tail, so it
    // leaves the ring the way it entered rather than blinking out.
    this.meteors = this.meteors.filter((m) => {
      const step = m.speed * n * dt;
      m.position = mod(m.position + m.direction * step, n);
      m.travelled += step;
      return m.travelled <= n + m.tail * n;
    });

    // `rate` is the expected number of launches per second.
    let expected = this.rate * dt;
    while (expected > 0) {
      if (expected < 1 && Math.random() >= expected) break;
      this.spawn();
      expected -= 1;
    }

    this.render();
  }

  private spawn() {
    const jitter = () => 1 + this.variation * (Math.random() * 2 - 1);
    this.meteors.push({
      position: Math.random() * this.state.length,
      travelled: 0,
      speed: Math.max(0.001, this.speed * jitter()),
      tail: Math.max(0.001, this.tail * jitter()),
      direction: this.direction === 0 ? (Math.random() < 0.5 ? 1 : -1) : this.direction
    });
  }

  private render() {
    const n = this.state.length;
    for (let i = 0; i < n; i++) {
      this.state[i] = { r: this.r, g: this.g, b: this.b, a: 0 };
    }
    for (const m of this.meteors) {
      const tail = Math.max(1, m.tail * n);
      // The tail can only be as long as the meteor has actually travelled, so a new
      // meteor grows its tail instead of appearing with a full one.
      const length = Math.min(tail, m.travelled);
      const head = Math.round(m.position);
      for (let d = 0; d <= length; d++) {
        const light = this.state[mod(head - m.direction * d, n)];
        light.a = Math.max(light.a, 1 - d / tail);
      }
    }
  }
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}
