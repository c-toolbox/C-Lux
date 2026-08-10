import { type Color, Pattern, type PatternBaseProps } from './pattern.ts';

export type MovingGaussianProps = PatternBaseProps &
  Color & {
    sigma: number;
    speed: number;
  };

export class MovingGaussianPattern extends Pattern {
  static readonly Type = 'MovingGaussian';

  r!: number;
  g!: number;
  b!: number;
  sigma!: number;
  speed!: number;

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
      speed: this.speed
    };
  }

  set({ r, g, b, sigma, speed }: Partial<MovingGaussianProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.sigma = sigma ?? this.sigma;
    this.speed = speed ?? this.speed;

    // Gaussian bump centered on index 0; rotation moves it around the ring.
    const n = this.state.length;
    const twoSigmaSq = 2 * this.sigma * this.sigma;
    for (let i = 0; i < n; i++) {
      const d = Math.min(i, n - i); // circular distance from the center
      const intensity =
        twoSigmaSq > 0 ? Math.exp(-(d * d) / twoSigmaSq) : d === 0 ? 1 : 0;
      this.state[i] = {
        r: Math.round(this.r * intensity),
        g: Math.round(this.g * intensity),
        b: Math.round(this.b * intensity)
      };
    }
  }

  tick(dt: number) {
    this.offset += this.speed * dt;
    const steps = Math.trunc(this.offset);
    if (steps !== 0) {
      this.offset -= steps;
      this.rotate(steps);
    }
  }
}
