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

export type RippleProps = PatternBaseProps &
  Color & {
    // Expansion speed in full turns per second, width as a fraction of the ring, the
    // spawn interval in seconds and the drop point as a share of the circumference.
    speed: number;
    width: number;
    decay: number;
    interval: number;
    origin: number;
  };

// A wave front travelling outward in both directions from where it was dropped.
interface Wave {
  position: number;
  radius: number;
  amplitude: number;
}

export class RipplePattern extends Pattern {
  static readonly Type = 'Ripple';
  static readonly DisplayName = 'Ripple';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color', default: { r: 77, g: 171, b: 247 } },
    speed: {
      kind: 'number',
      label: 'Speed (turns/s)',
      default: 0.25,
      step: 0.05,
      row: 0,
      ...POSITIVE
    },
    width: {
      kind: 'number',
      label: 'Width (ring share)',
      default: 0.04,
      step: 0.01,
      row: 0,
      ...POSITIVE_UNIT
    },
    decay: {
      kind: 'number',
      label: 'Decay',
      default: 0.5,
      step: 0.1,
      row: 1,
      ...NON_NEGATIVE
    },
    interval: {
      kind: 'number',
      label: 'Interval (s)',
      default: 2,
      step: 0.5,
      row: 1,
      ...POSITIVE
    },
    origin: { kind: 'number', label: 'Origin', default: 0, step: 0.05, row: 1, ...UNIT }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  speed!: number;
  width!: number;
  decay!: number;
  interval!: number;
  origin!: number;

  private waves: Wave[] = [];
  private timer = 0;

  constructor(props: RippleProps) {
    super(props);
    this.set(props);
    this.spawn();
    this.render();
  }

  parameters(): {
    name: string;
    type: typeof RipplePattern.Type;
    color: Color;
    speed: number;
    width: number;
    decay: number;
    interval: number;
    origin: number;
  } {
    return {
      name: this.name,
      type: RipplePattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      speed: this.speed,
      width: this.width,
      decay: this.decay,
      interval: this.interval,
      origin: this.origin
    };
  }

  set({ r, g, b, speed, width, decay, interval, origin }: Partial<RippleProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.speed = speed ?? this.speed;
    this.width = width ?? this.width;
    this.decay = decay ?? this.decay;
    this.interval = interval ?? this.interval;
    this.origin = origin ?? this.origin;
    this.render();
  }

  tick(dt: number) {
    const n = this.state.length;

    const fade = Math.exp(-this.decay * dt);
    // A front is done once it has faded out or its two halves have met on the far side.
    const reach = n / 2 + 3 * this.width * n;
    this.waves = this.waves.filter((w) => {
      w.radius += this.speed * n * dt;
      w.amplitude *= fade;
      return w.amplitude > 0.01 && w.radius <= reach;
    });

    this.timer += dt;
    while (this.interval > 0 && this.timer >= this.interval) {
      this.timer -= this.interval;
      this.spawn();
    }

    this.render();
  }

  private spawn() {
    const n = this.state.length;
    this.waves.push({
      position: mod(this.origin * n, n),
      radius: 0,
      amplitude: 1
    });
  }

  private render() {
    const n = this.state.length;
    const width = this.width > 0 ? this.width * n : 0.0001;
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (const w of this.waves) {
        const offset = (ringDistance(i, w.position, n) - w.radius) / width;
        a += w.amplitude * Math.exp(-offset * offset);
      }
      this.state[i] = { r: this.r, g: this.g, b: this.b, a: Math.min(1, a) };
    }
  }
}

// Shortest distance between a light and a drop point, measured around the ring.
function ringDistance(i: number, position: number, n: number): number {
  const raw = Math.abs(i - position);
  return Math.min(raw, n - raw);
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}
