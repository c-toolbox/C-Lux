import { hsvToRgb, Pattern, type PatternBaseProps } from './pattern.ts';

export type ColorCycleProps = PatternBaseProps & {
  speed: number;
  saturation: number;
  value: number;
};

export class ColorCyclePattern extends Pattern {
  static readonly Type = 'ColorCycle';
  static readonly DisplayName = 'Color Cycle';

  speed!: number;
  saturation!: number;
  value!: number;

  // Current hue in degrees, shared by every light.
  private hue = 0;

  constructor(props: ColorCycleProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof ColorCyclePattern.Type;
    speed: number;
    saturation: number;
    value: number;
  } {
    return {
      name: this.name,
      type: ColorCyclePattern.Type,
      speed: this.speed,
      saturation: this.saturation,
      value: this.value
    };
  }

  set({ speed, saturation, value }: Partial<ColorCycleProps>) {
    this.speed = speed ?? this.speed;
    this.saturation = saturation ?? this.saturation;
    this.value = value ?? this.value;
    this.render();
  }

  advance(dt: number) {
    this.hue += this.speed * dt;
    this.render();
  }

  private render() {
    const { r, g, b } = hsvToRgb(this.hue, this.saturation, this.value);
    for (let i = 0; i < this.state.length; i++) {
      this.state[i] = { r, g, b, a: 1 };
    }
  }
}
