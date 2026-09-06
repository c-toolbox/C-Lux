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

export type RainProps = PatternBaseProps &
  Color & {
    // Drops per second, fall speed in full turns per second and trail length as a
    // fraction of the ring.
    rate: number;
    speed: number;
    length: number;
    splash: number;
  };

// A drop running down one side of the ring toward the bottom.
interface Drop {
  position: number;
  remaining: number;
  direction: number;
}

// A flash left where a drop landed, fading at a fixed rate.
interface Splash {
  amplitude: number;
}

const SPLASH_DECAY = 5;

export class RainPattern extends Pattern {
  static readonly Type = 'Rain';
  static readonly DisplayName = 'Rain';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color', default: { r: 77, g: 171, b: 247 } },
    rate: {
      kind: 'number',
      label: 'Rate (drops/s)',
      default: 4,
      step: 0.5,
      row: 0,
      ...NON_NEGATIVE
    },
    speed: {
      kind: 'number',
      label: 'Speed (turns/s)',
      default: 0.5,
      step: 0.05,
      row: 0,
      ...POSITIVE
    },
    length: {
      kind: 'number',
      label: 'Trail (fraction)',
      default: 0.05,
      step: 0.01,
      row: 1,
      ...POSITIVE_UNIT
    },
    splash: {
      kind: 'number',
      label: 'Splash',
      default: 0.8,
      step: 0.05,
      row: 1,
      hint: 'Brightness of the flash where a drop lands at the bottom.',
      ...UNIT
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  rate!: number;
  speed!: number;
  length!: number;
  splash!: number;

  private drops: Drop[] = [];
  private splashes: Splash[] = [];

  constructor(props: RainProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof RainPattern.Type;
    color: Color;
    rate: number;
    speed: number;
    length: number;
    splash: number;
  } {
    return {
      name: this.name,
      type: RainPattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      rate: this.rate,
      speed: this.speed,
      length: this.length,
      splash: this.splash
    };
  }

  set({ r, g, b, rate, speed, length, splash }: Partial<RainProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.rate = rate ?? this.rate;
    this.speed = speed ?? this.speed;
    this.length = length ?? this.length;
    this.splash = splash ?? this.splash;
    this.render();
  }

  tick(dt: number) {
    const n = this.state.length;
    const step = this.speed * n * dt;

    this.drops = this.drops.filter((drop) => {
      drop.position = mod(drop.position + drop.direction * step, n);
      drop.remaining -= step;
      if (drop.remaining > 0) return true;
      if (this.splash > 0) this.splashes.push({ amplitude: this.splash });
      return false;
    });

    const fade = Math.exp(-SPLASH_DECAY * dt);
    this.splashes = this.splashes.filter((splash) => {
      splash.amplitude *= fade;
      return splash.amplitude > 0.01;
    });

    // `rate` is the expected number of drops per second.
    let expected = this.rate * dt;
    while (expected > 0) {
      if (expected < 1 && Math.random() >= expected) break;
      this.spawn();
      expected -= 1;
    }

    this.render();
  }

  // Drops start near the top of the ring (light 0) and run down whichever side they
  // fell on, so the two halves fill in like water on a dome.
  private spawn() {
    const n = this.state.length;
    const direction = Math.random() < 0.5 ? 1 : -1;
    const offset = Math.random() * 0.1 * n;
    this.drops.push({
      position: mod(direction * offset, n),
      remaining: n / 2 - offset,
      direction
    });
  }

  private render() {
    const n = this.state.length;
    const alpha = Array.from({ length: n }, () => 0);

    const tail = Math.max(1, this.length * n);
    for (const drop of this.drops) {
      const head = Math.round(drop.position);
      for (let d = 0; d <= tail; d++) {
        const i = mod(head - drop.direction * d, n);
        alpha[i] = Math.max(alpha[i], 1 - d / tail);
      }
    }

    // Everything lands at the bottom of the ring, so splashes pile up on the same lights.
    const bottom = Math.round(n / 2);
    for (const splash of this.splashes) {
      for (let d = -1; d <= 1; d++) {
        const i = mod(bottom + d, n);
        alpha[i] = Math.min(1, Math.max(alpha[i], splash.amplitude / (1 + Math.abs(d))));
      }
    }

    for (let i = 0; i < n; i++) {
      this.state[i] = { r: this.r, g: this.g, b: this.b, a: alpha[i] };
    }
  }
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}
