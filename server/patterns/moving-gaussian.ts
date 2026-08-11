import { type Color, Pattern, type PatternBaseProps } from './pattern.ts';

export type MovingGaussianProps = PatternBaseProps &
  Color & {
    sigma: number;
    speed: number;
    origin: number;
  };

export class MovingGaussianPattern extends Pattern {
  static readonly Type = 'MovingGaussian';
  static readonly DisplayName = 'Moving Gaussian';

  r!: number;
  g!: number;
  b!: number;
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
        b: this.b
      },
      sigma: this.sigma,
      speed: this.speed,
      origin: this.origin
    };
  }

  set({ r, g, b, sigma, speed, origin }: Partial<MovingGaussianProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.sigma = sigma ?? this.sigma;
    this.speed = speed ?? this.speed;
    this.origin = origin ?? this.origin;

    // Gaussian bump centered on the origin index; rotation moves it around the ring.
    const n = this.state.length;
    const twoSigmaSq = 2 * this.sigma * this.sigma;
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(i - this.origin);
      const d = Math.min(diff, n - diff); // circular distance from the origin
      const intensity =
        twoSigmaSq > 0 ? Math.exp(-(d * d) / twoSigmaSq) : d === 0 ? 1 : 0;
      this.state[i] = {
        r: this.r,
        g: this.g,
        b: this.b,
        a: intensity
      };
    }
  }

  advance(dt: number) {
    this.offset += this.speed * dt;
    const steps = Math.trunc(this.offset);
    if (steps !== 0) {
      this.offset -= steps;
      this.rotate(steps);
    }
  }
}
