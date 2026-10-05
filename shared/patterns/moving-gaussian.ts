import {
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  UNIT
} from './pattern.ts';

export type MovingGaussianProps = PatternBaseProps &
  Color & {
    // Fractions of the ring: sigma and origin as a share of the circumference, speed in
    // full turns per second.
    sigma: number;
    speed: number;
    origin: number;
  };

export class MovingGaussianPattern extends Pattern {
  static readonly Type = 'MovingGaussian';
  static readonly DisplayName = 'Moving Gaussian';
  static readonly Fields = {
    color: {
      kind: 'color',
      label: 'Color',
      default: { r: 77, g: 171, b: 247 },
      hint: 'Color of the bump.'
    },
    sigma: {
      kind: 'number',
      label: 'Sigma (fraction)',
      hint: 'Width of the bump as a fraction of the ring.',
      default: 0.04,
      step: 0.01,
      row: 0,
      ...UNIT
    },
    speed: {
      kind: 'number',
      label: 'Speed (turns/s)',
      hint: 'How fast the bump travels around the ring; negative reverses.',
      default: 0.07,
      step: 0.05,
      row: 0
    },
    origin: {
      kind: 'number',
      label: 'Origin (fraction)',
      hint: 'Where the bump starts, as a fraction of the ring.',
      default: 0,
      step: 0.01,
      ...UNIT
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  a = 1;
  sigma!: number;
  speed!: number;
  origin!: number;

  // Carries the sub-step remainder between ticks so slow speeds still advance.
  private offset = 0;

  constructor(props: MovingGaussianProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof MovingGaussianPattern.Type;
    color: Color;
    sigma: number;
    speed: number;
    origin: number;
  } {
    return {
      name: this.name,
      type: MovingGaussianPattern.Type,
      color: {
        r: this.r,
        g: this.g,
        b: this.b,
        a: this.a
      },
      sigma: this.sigma,
      speed: this.speed,
      origin: this.origin
    };
  }

  set({ r, g, b, a, sigma, speed, origin }: Partial<MovingGaussianProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.a = a ?? this.a;
    this.sigma = sigma ?? this.sigma;
    this.speed = speed ?? this.speed;
    this.origin = origin ?? this.origin;

    // Gaussian bump centered on the origin index; rotation moves it around the ring.
    const n = this.state.length;
    const sigmaLights = this.sigma * n;
    const originLights = (((this.origin * n) % n) + n) % n;
    const twoSigmaSq = 2 * sigmaLights * sigmaLights;
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(i - originLights);
      const d = Math.min(diff, n - diff); // circular distance from the origin
      const intensity =
        twoSigmaSq > 0 ? Math.exp(-(d * d) / twoSigmaSq) : d === 0 ? 1 : 0;
      this.state[i] = {
        r: this.r,
        g: this.g,
        b: this.b,
        a: intensity * this.a
      };
    }
  }

  tick(dt: number) {
    this.offset += this.speed * this.state.length * dt;
    const steps = Math.trunc(this.offset);
    if (steps !== 0) {
      this.offset -= steps;
      // Rotating backwards walks the bump to higher indices, like every other pattern.
      this.rotate(-steps);
    }
  }
}
