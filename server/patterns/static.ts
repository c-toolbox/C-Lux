import { type Color, Pattern, type PatternBaseProps } from './pattern.ts';

export type StaticProps = PatternBaseProps & Color;

export class StaticPattern extends Pattern {
  static readonly Type = 'StaticPattern';
  static readonly DisplayName = 'Static';

  r!: number;
  g!: number;
  b!: number;

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

    for (const state of this.state) {
      state.r = this.r;
      state.g = this.g;
      state.b = this.b;
      state.a = 1;
    }
  }

  advance(_dt: number) {
    // noop
  }
}
