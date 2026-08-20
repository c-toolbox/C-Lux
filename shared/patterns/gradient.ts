import {
  ANY,
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema
} from './pattern.ts';

export type GradientProps = PatternBaseProps &
  Color & {
    color2: Color;
    speed: number;
  };

export class GradientPattern extends Pattern {
  static readonly Type = 'Gradient';
  static readonly DisplayName = 'Gradient';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color A', default: { r: 77, g: 171, b: 247 } },
    color2: { kind: 'color', label: 'Color B', default: { r: 247, g: 77, b: 77 } },
    speed: { kind: 'number', label: 'Drift (cycles/s)', default: 0.1, step: 0.05, ...ANY }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  color2!: Color;
  speed!: number;

  // Drift offset in cycles that slides the gradient around the ring.
  private phase = 0;

  constructor(props: GradientProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof GradientPattern.Type;
    color: Color;
    color2: Color;
    speed: number;
  } {
    return {
      name: this.name,
      type: GradientPattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      color2: { ...this.color2 },
      speed: this.speed
    };
  }

  set({ r, g, b, color2, speed }: Partial<GradientProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.color2 = color2 ?? this.color2;
    this.speed = speed ?? this.speed;
    this.render();
  }

  advance(dt: number) {
    this.phase += this.speed * dt;
    this.render();
  }

  private render() {
    const n = this.state.length;
    for (let i = 0; i < n; i++) {
      // Cosine blend so the two colors meet seamlessly around the ring.
      const t = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i / n + this.phase));
      this.state[i] = {
        r: this.r + (this.color2.r - this.r) * t,
        g: this.g + (this.color2.g - this.g) * t,
        b: this.b + (this.color2.b - this.b) * t,
        a: 1
      };
    }
  }
}
