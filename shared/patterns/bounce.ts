import {
  ANY,
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  UNIT
} from './pattern.ts';

export type BounceProps = PatternBaseProps &
  Color & {
    // Sigma is a fraction of the ring and speed is in full turns per second.
    sigma: number;
    speed: number;
  };

export class BouncePattern extends Pattern {
  static readonly Type = 'Bounce';
  static readonly DisplayName = 'Bounce';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color', default: { r: 77, g: 171, b: 247 } },
    sigma: {
      kind: 'number',
      label: 'Sigma (fraction)',
      default: 0.04,
      step: 0.01,
      row: 0,
      ...UNIT
    },
    speed: {
      kind: 'number',
      label: 'Speed (turns/s)',
      default: 0.1,
      step: 0.05,
      row: 0,
      ...ANY
    }
  } satisfies PatternSchema;

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
    // Turn around after a full turn in each direction. Both ends are the same light on
    // the ring, so the bump reverses at the seam rather than stopping short of it.
    while (pos < 0 || pos > n) {
      if (pos < 0) {
        pos = -pos;
        this.direction = 1;
      } else {
        pos = 2 * n - pos;
        this.direction = -1;
      }
    }
    this.position = pos;
    this.render();
  }

  private render() {
    const n = this.state.length;
    const sigmaLights = this.sigma * n;
    const twoSigmaSq = 2 * sigmaLights * sigmaLights;
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(i - this.position);
      const d = Math.min(diff, n - diff); // circular distance, so the tail wraps the seam
      const a = twoSigmaSq > 0 ? Math.exp(-(d * d) / twoSigmaSq) : d === 0 ? 1 : 0;
      this.state[i] = { r: this.r, g: this.g, b: this.b, a };
    }
  }
}
