import { type Color, Pattern, type PatternBaseProps } from './pattern.ts';

export type BounceProps = PatternBaseProps &
  Color & {
    // Sigma is a fraction of the ring and speed is in full turns per second.
    sigma: number;
    speed: number;
  };

export class BouncePattern extends Pattern {
  static readonly Type = 'Bounce';
  static readonly DisplayName = 'Bounce';

  r!: number;
  g!: number;
  b!: number;
  sigma!: number;
  speed!: number;

  // Bump center in lights and its current travel direction.
  private position = 0;
  private direction = 1;

  constructor(props: BounceProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof BouncePattern.Type;
    color: Color;
    sigma: number;
    speed: number;
  } {
    return {
      name: this.name,
      type: BouncePattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      sigma: this.sigma,
      speed: this.speed
    };
  }

  set({ r, g, b, sigma, speed }: Partial<BounceProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.sigma = sigma ?? this.sigma;
    this.speed = speed ?? this.speed;
    this.render();
  }

  advance(dt: number) {
    const n = this.state.length;
    if (n === 0) return;
    let pos = this.position + this.speed * n * this.direction * dt;
    const max = n - 1;
    // Reflect off both ends so the bump ping-pongs instead of wrapping.
    while (pos < 0 || pos > max) {
      if (pos < 0) {
        pos = -pos;
        this.direction = 1;
      } else if (pos > max) {
        pos = 2 * max - pos;
        this.direction = -1;
      }
    }
    this.position = pos;
    this.render();
  }

  private render() {
    const n = this.state.length;
    const max = n - 1;
    const sigmaLights = this.sigma * n;
    const twoSigmaSq = 2 * sigmaLights * sigmaLights;
    // Reflect the bump's center about both ends so the gaussian tail folds
    // back at the walls instead of being clipped at index 0 / n-1.
    const centers = [this.position, -this.position, 2 * max - this.position];
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (const c of centers) {
        const d = i - c;
        const g = twoSigmaSq > 0 ? Math.exp(-(d * d) / twoSigmaSq) : d === 0 ? 1 : 0;
        if (g > a) a = g;
      }
      this.state[i] = { r: this.r, g: this.g, b: this.b, a };
    }
  }
}
