import {
  type Color,
  mixColors,
  Pattern,
  type PatternBaseProps,
  type PatternSchema
} from './pattern.ts';

export type GradientProps = PatternBaseProps & {
  colors: Color[];
  speed: number;
};

export class GradientPattern extends Pattern {
  static readonly Type = 'Gradient';
  static readonly DisplayName = 'Gradient';
  static readonly Fields = {
    colors: {
      kind: 'colors',
      label: 'Colors',
      default: [
        { r: 77, g: 171, b: 247 },
        { r: 247, g: 77, b: 77 }
      ],
      minCount: 2,
      maxCount: Infinity,
      hint: 'Colors spread evenly around the ring, each blending into the next.'
    },
    speed: {
      kind: 'number',
      label: 'Drift (cycles/s)',
      default: 0.1,
      step: 0.05,
      hint: 'How fast the gradient slides around the ring; negative reverses.'
    }
  } satisfies PatternSchema;

  colors!: Color[];
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
    colors: Color[];
    speed: number;
  } {
    return {
      name: this.name,
      type: GradientPattern.Type,
      colors: this.colors.map((c) => ({ ...c })),
      speed: this.speed
    };
  }

  set({ colors, speed }: Partial<GradientProps>) {
    this.colors = colors ?? this.colors;
    this.speed = speed ?? this.speed;
    this.render();
  }

  tick(dt: number) {
    this.phase += this.speed * dt;
    this.render();
  }

  private render() {
    const n = this.state.length;
    const k = this.colors.length;
    for (let i = 0; i < n; i++) {
      const x = ((((i / n + this.phase) % 1) + 1) % 1) * k;
      const from = Math.floor(x) % k;
      // Cosine blend so neighboring colors meet without a visible kink.
      const t = 0.5 - 0.5 * Math.cos(Math.PI * (x - Math.floor(x)));
      this.state[i] = mixColors(this.colors[from], this.colors[(from + 1) % k], t);
    }
  }
}
