import { type Color, Pattern, type PatternBaseProps } from './pattern.ts';

export type StaticProps = PatternBaseProps & Color;

export class StaticPattern extends Pattern {
  static readonly Type = 'StaticPattern';

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
    paused: boolean;
    color: Color;
  } {
    return {
      name: this.name,
      type: StaticPattern.Type,
      paused: this.paused,
      color: {
        r: this.r,
        g: this.g,
        b: this.b
      }
    };
  }

  set({ r, g, b, paused }: Partial<StaticProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.paused = paused ?? this.paused;

    for (const state of this.state) {
      state.r = this.r;
      state.g = this.g;
      state.b = this.b;
      state.a = 1;
    }
  }

  /* eslint-disable  @typescript-eslint/no-unused-vars */
  advance(_dt: number) {
    // noop
  }
}
