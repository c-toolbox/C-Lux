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

export type MeteorsProps = PatternBaseProps & {
  // Meteors launched per second, speed in full turns per second and tail length as a
  // fraction of the ring. Every meteor picks one of `colors` at random.
  colors: Color[];
  rate: number;
  speed: number;
  maxSpeed: number;
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
  color: Color;
}

export class MeteorsPattern extends Pattern {
  static readonly Type = 'Meteors';
  static readonly DisplayName = 'Meteors';
  static readonly Fields = {
    colors: {
      kind: 'colors',
      label: 'Colors',
      default: [{ r: 255, g: 255, b: 255 }],
      hint: 'Each meteor picks one of these at random.'
    },
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
    maxSpeed: {
      kind: 'number',
      label: 'Max speed (turns/s)',
      default: 1,
      step: 0.05,
      row: 0,
      hint: 'Upper limit for a single meteor once variation is applied.',
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

  colors: Color[] = MeteorsPattern.Fields.colors.default.map((c) => ({ ...c }));
  rate!: number;
  speed!: number;
  maxSpeed: number = MeteorsPattern.Fields.maxSpeed.default;
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
    colors: Color[];
    rate: number;
    speed: number;
    maxSpeed: number;
    tail: number;
    variation: number;
    direction: number;
  } {
    return {
      name: this.name,
      type: MeteorsPattern.Type,
      colors: this.colors.map((c) => ({ ...c })),
      rate: this.rate,
      speed: this.speed,
      maxSpeed: this.maxSpeed,
      tail: this.tail,
      variation: this.variation,
      direction: this.direction
    };
  }

  set({
    colors,
    rate,
    speed,
    maxSpeed,
    tail,
    variation,
    direction
  }: Partial<MeteorsProps>) {
    this.colors = colors?.length ? colors.map((c) => ({ ...c })) : this.colors;
    this.rate = rate ?? this.rate;
    this.speed = speed ?? this.speed;
    this.maxSpeed = maxSpeed ?? this.maxSpeed;
    this.tail = tail ?? this.tail;
    this.variation = variation ?? this.variation;
    this.direction = direction ?? this.direction;
    this.render();
  }

  tick(dt: number) {
    const n = this.state.length;

    // A meteor is retired once it has covered a full turn plus its own tail, by which
    // point the tail has collapsed into the head (see `render`).
    this.meteors = this.meteors.filter((m) => {
      const step = m.speed * n * dt;
      m.position = mod(m.position + m.direction * step, n);
      m.travelled += step;
      return m.travelled <= n + tailLength(m, n);
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
      speed: Math.min(this.maxSpeed, Math.max(0.001, this.speed * jitter())),
      tail: Math.max(0.001, this.tail * jitter()),
      direction: this.direction === 0 ? (Math.random() < 0.5 ? 1 : -1) : this.direction,
      color: this.colors[Math.floor(Math.random() * this.colors.length)]
    });
  }

  private render() {
    const n = this.state.length;
    for (let i = 0; i < n; i++) {
      this.state[i] = { r: 0, g: 0, b: 0, a: 0 };
    }
    for (const m of this.meteors) {
      const tail = tailLength(m, n);
      // The tail can only be as long as the meteor has actually travelled, so a new
      // meteor grows its tail instead of appearing with a full one. Past a full turn
      // `left` shrinks it again, so the tail catches up with the head and the meteor
      // collapses to a point rather than blinking out.
      const left = n + tail - m.travelled;
      const length = Math.min(tail, m.travelled, left);
      const fade = Math.min(1, left / tail);
      const head = Math.round(m.position);
      for (let d = 0; d <= length; d++) {
        const light = this.state[mod(head - m.direction * d, n)];
        const a = (1 - d / tail) * fade;
        if (a <= light.a) continue;
        light.r = m.color.r;
        light.g = m.color.g;
        light.b = m.color.b;
        light.a = a;
      }
    }
  }
}

// A meteor's tail in lights, never shorter than the single light of the head itself.
function tailLength(m: Meteor, n: number): number {
  return Math.max(1, m.tail * n);
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}
