import {
  hsvToRgb,
  NON_NEGATIVE,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE,
  POSITIVE_UNIT,
  UNIT
} from './pattern.ts';

export type FireworksProps = PatternBaseProps & {
  // Launches per second, travel speed in full turns per second and the burst size as a
  // fraction of the ring.
  rate: number;
  speed: number;
  spread: number;
  decay: number;
  origin: number;
  saturation: number;
};

// A shell on its way to the point where it will burst.
interface Rocket {
  position: number;
  remaining: number;
  direction: number;
  hue: number;
}

// The expanding pair of fronts a shell leaves behind.
interface Burst {
  position: number;
  radius: number;
  amplitude: number;
  hue: number;
}

export class FireworksPattern extends Pattern {
  static readonly Type = 'Fireworks';
  static readonly DisplayName = 'Fireworks';
  static readonly Fields = {
    rate: {
      kind: 'number',
      label: 'Rate (per s)',
      default: 0.6,
      step: 0.1,
      row: 0,
      ...NON_NEGATIVE
    },
    speed: {
      kind: 'number',
      label: 'Speed (turns/s)',
      default: 0.6,
      step: 0.05,
      row: 0,
      ...POSITIVE
    },
    spread: {
      kind: 'number',
      label: 'Burst (fraction)',
      default: 0.15,
      step: 0.01,
      row: 1,
      ...POSITIVE_UNIT
    },
    decay: {
      kind: 'number',
      label: 'Decay',
      default: 1.5,
      step: 0.1,
      row: 1,
      ...NON_NEGATIVE
    },
    origin: {
      kind: 'number',
      label: 'Launch point',
      default: 0.5,
      step: 0.05,
      row: 2,
      ...UNIT
    },
    saturation: {
      kind: 'number',
      label: 'Saturation',
      default: 1,
      step: 0.05,
      row: 2,
      hint: 'Each shell picks its own hue; this sets how strong those colors are.',
      ...UNIT
    }
  } satisfies PatternSchema;

  rate!: number;
  speed!: number;
  spread!: number;
  decay!: number;
  origin!: number;
  saturation!: number;

  private rockets: Rocket[] = [];
  private bursts: Burst[] = [];

  constructor(props: FireworksProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof FireworksPattern.Type;
    rate: number;
    speed: number;
    spread: number;
    decay: number;
    origin: number;
    saturation: number;
  } {
    return {
      name: this.name,
      type: FireworksPattern.Type,
      rate: this.rate,
      speed: this.speed,
      spread: this.spread,
      decay: this.decay,
      origin: this.origin,
      saturation: this.saturation
    };
  }

  set({ rate, speed, spread, decay, origin, saturation }: Partial<FireworksProps>) {
    this.rate = rate ?? this.rate;
    this.speed = speed ?? this.speed;
    this.spread = spread ?? this.spread;
    this.decay = decay ?? this.decay;
    this.origin = origin ?? this.origin;
    this.saturation = saturation ?? this.saturation;
    this.render();
  }

  tick(dt: number) {
    const n = this.state.length;
    const step = this.speed * n * dt;

    this.rockets = this.rockets.filter((rocket) => {
      rocket.position = mod(rocket.position + rocket.direction * step, n);
      rocket.remaining -= step;
      if (rocket.remaining > 0) return true;
      this.bursts.push({
        position: rocket.position,
        radius: 0,
        amplitude: 1,
        hue: rocket.hue
      });
      return false;
    });

    const fade = Math.exp(-this.decay * dt);
    const reach = this.spread * n;
    this.bursts = this.bursts.filter((burst) => {
      burst.radius += step;
      burst.amplitude *= fade;
      return burst.amplitude > 0.01 && burst.radius <= reach;
    });

    // `rate` is the expected number of launches per second.
    let expected = this.rate * dt;
    while (expected > 0) {
      if (expected < 1 && Math.random() >= expected) break;
      this.launch();
      expected -= 1;
    }

    this.render();
  }

  private launch() {
    const n = this.state.length;
    this.rockets.push({
      position: mod(this.origin * n, n),
      // Somewhere between a sixth and half a turn away, so shells burst all around.
      remaining: n * (0.15 + Math.random() * 0.35),
      direction: Math.random() < 0.5 ? 1 : -1,
      hue: Math.random() * 360
    });
  }

  private render() {
    const n = this.state.length;
    // Contributions add up, so overlapping bursts read as a brighter, whiter flash.
    const acc = Array.from({ length: n }, () => ({ r: 0, g: 0, b: 0, a: 0 }));

    for (const rocket of this.rockets) {
      // The shell itself is a small, nearly white dot with a two-light trail.
      const color = hsvToRgb(rocket.hue, this.saturation * 0.3, 1);
      const head = Math.round(rocket.position);
      for (let d = 0; d < 3; d++) {
        add(acc[mod(head - rocket.direction * d, n)], color, 1 - d / 3);
      }
    }

    const width = Math.max(1, this.spread * n * 0.25);
    for (const burst of this.bursts) {
      const color = hsvToRgb(burst.hue, this.saturation, 1);
      for (let i = 0; i < n; i++) {
        const offset = (ringDistance(i, burst.position, n) - burst.radius) / width;
        const weight = burst.amplitude * Math.exp(-offset * offset);
        if (weight > 0.01) add(acc[i], color, weight);
      }
    }

    for (let i = 0; i < n; i++) {
      const { r, g, b, a } = acc[i];
      this.state[i] = {
        r: Math.round(Math.min(255, r)),
        g: Math.round(Math.min(255, g)),
        b: Math.round(Math.min(255, b)),
        a: Math.min(1, a)
      };
    }
  }
}

function add(
  target: { r: number; g: number; b: number; a: number },
  color: { r: number; g: number; b: number },
  weight: number
) {
  target.r += color.r * weight;
  target.g += color.g * weight;
  target.b += color.b * weight;
  target.a += weight;
}

// Shortest distance between a light and a point, measured around the ring.
function ringDistance(i: number, position: number, n: number): number {
  const raw = Math.abs(i - position);
  return Math.min(raw, n - raw);
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}
