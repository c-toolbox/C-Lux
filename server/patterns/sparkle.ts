import { type Color, Pattern, type PatternBaseProps } from './pattern.ts';

export type SparkleProps = PatternBaseProps &
  Color & {
    // Share of the ring igniting per second (1 = as many sparkles as there are lights).
    density: number;
    decay: number;
  };

export class SparklePattern extends Pattern {
  static readonly Type = 'Sparkle';
  static readonly DisplayName = 'Sparkle';

  r!: number;
  g!: number;
  b!: number;
  density!: number;
  decay!: number;

  // Per-light brightness in [0, 1]; sparkles ignite at 1 and fade toward 0.
  private intensities: number[] = Array.from({ length: this.state.length }, () => 0);

  constructor(props: SparkleProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof SparklePattern.Type;
    color: Color;
    density: number;
    decay: number;
  } {
    return {
      name: this.name,
      type: SparklePattern.Type,
      color: {
        r: this.r,
        g: this.g,
        b: this.b
      },
      density: this.density,
      decay: this.decay
    };
  }

  set({ r, g, b, density, decay }: Partial<SparkleProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.density = density ?? this.density;
    this.decay = decay ?? this.decay;

    this.render();
  }

  advance(dt: number) {
    const n = this.state.length;

    // Fade every active sparkle toward zero.
    const factor = Math.exp(-this.decay * dt);
    for (let i = 0; i < n; i++) {
      this.intensities[i] *= factor;
    }

    // Ignite new sparkles; `density` is the expected share of the ring spawned per second.
    let expected = this.density * n * dt;
    while (expected > 0) {
      if (expected < 1 && Math.random() >= expected) break;
      const i = Math.floor(Math.random() * n);
      this.intensities[i] = 1;
      expected -= 1;
    }

    this.render();
  }

  // Paint the current sparkle intensities onto the light state.
  private render() {
    for (let i = 0; i < this.state.length; i++) {
      const intensity = this.intensities[i] ?? 0;
      this.state[i] = {
        r: this.r,
        g: this.g,
        b: this.b,
        a: intensity
      };
    }
  }
}
