import {
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE,
  UNIT
} from './pattern.ts';

export type CandleProps = PatternBaseProps &
  Color & {
    // Base brightness, how far the flicker dips below it and how often each light
    // re-aims, in times per second.
    brightness: number;
    depth: number;
    speed: number;
  };

export class CandlePattern extends Pattern {
  static readonly Type = 'Candle';
  static readonly DisplayName = 'Candle';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color', default: { r: 255, g: 147, b: 41 } },
    brightness: {
      kind: 'number',
      label: 'Brightness',
      default: 1,
      step: 0.05,
      row: 0,
      ...UNIT
    },
    depth: {
      kind: 'number',
      label: 'Flicker depth',
      default: 0.45,
      step: 0.05,
      row: 0,
      ...UNIT
    },
    speed: {
      kind: 'number',
      label: 'Flicker (per s)',
      default: 6,
      step: 0.5,
      row: 0,
      ...POSITIVE
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  brightness!: number;
  depth!: number;
  speed!: number;

  // Each light drifts toward its own target rather than jumping to it, so neighbouring
  // lights wander independently and the flame reads as unsteady instead of noisy.
  private levels: number[] = Array.from({ length: this.state.length }, () => 1);
  private targets: number[] = Array.from({ length: this.state.length }, () =>
    Math.random()
  );

  constructor(props: CandleProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof CandlePattern.Type;
    color: Color;
    brightness: number;
    depth: number;
    speed: number;
  } {
    return {
      name: this.name,
      type: CandlePattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      brightness: this.brightness,
      depth: this.depth,
      speed: this.speed
    };
  }

  set({ r, g, b, brightness, depth, speed }: Partial<CandleProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.brightness = brightness ?? this.brightness;
    this.depth = depth ?? this.depth;
    this.speed = speed ?? this.speed;
    this.render();
  }

  tick(dt: number) {
    const blend = 1 - Math.exp(-this.speed * dt);
    const reaim = this.speed * dt;
    for (let i = 0; i < this.state.length; i++) {
      if (Math.random() < reaim) this.targets[i] = Math.random();
      this.levels[i] += (this.targets[i] - this.levels[i]) * blend;
    }
    this.render();
  }

  private render() {
    for (let i = 0; i < this.state.length; i++) {
      const level = this.levels[i] ?? 1;
      this.state[i] = {
        r: this.r,
        g: this.g,
        b: this.b,
        a: this.brightness * (1 - this.depth + this.depth * level)
      };
    }
  }
}
