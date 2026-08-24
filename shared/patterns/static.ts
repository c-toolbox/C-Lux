import {
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema
} from './pattern.ts';

export type StaticProps = PatternBaseProps & Color;

// Reserved name of the fixed solid color layer the server keeps outside the pattern
// list and drives through the /api/solid-color endpoints.
export const SOLID_COLOR_NAME = 'solid-color';

export class StaticPattern extends Pattern {
  static readonly Type = 'StaticPattern';
  static readonly DisplayName = 'Static';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color', default: { r: 77, g: 171, b: 247 } }
  } satisfies PatternSchema;

  // The configured color. While a `fadeTo` is running the lights show a blend of
  // `fadeFrom` and this, so it is the destination rather than what is currently lit.
  r!: number;
  g!: number;
  b!: number;

  private fadeFrom: Color = { r: 0, g: 0, b: 0 };
  private fadeDuration = 0;
  private fadeElapsed = 0;

  constructor(props: StaticProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof StaticPattern.Type;
    color: Color;
  } {
    return {
      name: this.name,
      type: StaticPattern.Type,
      color: {
        r: this.r,
        g: this.g,
        b: this.b
      }
    };
  }

  set({ r, g, b }: Partial<StaticProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;

    this.fadeDuration = 0;
    this.fadeElapsed = 0;
    this.paint(this.r, this.g, this.b);
  }

  /**
   * The color currently on the lights, which differs from the configured color while a
   * fade started by `fadeTo` is still running.
   */
  color(): Color {
    const t = this.progress();
    return {
      r: Math.round(this.fadeFrom.r + (this.r - this.fadeFrom.r) * t),
      g: Math.round(this.fadeFrom.g + (this.g - this.fadeFrom.g) * t),
      b: Math.round(this.fadeFrom.b + (this.b - this.fadeFrom.b) * t)
    };
  }

  /**
   * Interpolate from the color currently on the lights to `color` over `duration`
   * seconds. A non-positive duration switches immediately.
   */
  fadeTo(color: Color, duration: number) {
    if (duration <= 0) {
      this.set(color);
      return;
    }

    this.fadeFrom = this.color();
    this.r = color.r;
    this.g = color.g;
    this.b = color.b;
    this.fadeDuration = duration;
    this.fadeElapsed = 0;
  }

  fading(): boolean {
    return this.fadeElapsed < this.fadeDuration;
  }

  advance(dt: number) {
    if (!this.fading()) return;

    this.fadeElapsed += dt;
    const { r, g, b } = this.color();
    this.paint(r, g, b);
  }

  private progress(): number {
    if (this.fadeDuration <= 0) return 1;
    return Math.min(1, this.fadeElapsed / this.fadeDuration);
  }

  private paint(r: number, g: number, b: number) {
    for (const state of this.state) {
      state.r = r;
      state.g = g;
      state.b = b;
      state.a = 1;
    }
  }
}
