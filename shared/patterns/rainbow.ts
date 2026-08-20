import {
  ANY,
  hsvToRgb,
  NON_NEGATIVE,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  UNIT
} from './pattern.ts';

export type RainbowProps = PatternBaseProps & {
  speed: number;
  saturation: number;
  value: number;
  cycles: number;
};

export class RainbowPattern extends Pattern {
  static readonly Type = 'Rainbow';
  static readonly DisplayName = 'Rainbow';
  static readonly Fields = {
    speed: { kind: 'number', label: 'Speed (°/s)', default: 60, step: 5, row: 0, ...ANY },
    cycles: {
      kind: 'number',
      label: 'Cycles',
      default: 1,
      step: 1,
      row: 0,
      ...NON_NEGATIVE
    },
    saturation: {
      kind: 'number',
      label: 'Saturation',
      default: 1,
      step: 0.05,
      row: 1,
      ...UNIT
    },
    value: { kind: 'number', label: 'Value', default: 1, step: 0.05, row: 1, ...UNIT }
  } satisfies PatternSchema;

  speed!: number;
  saturation!: number;
  value!: number;
  cycles!: number;

  // Hue offset (in degrees) that scrolls the spectrum around the ring.
  private phase = 0;

  constructor(props: RainbowProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof RainbowPattern.Type;
    speed: number;
    saturation: number;
    value: number;
    cycles: number;
  } {
    return {
      name: this.name,
      type: RainbowPattern.Type,
      speed: this.speed,
      saturation: this.saturation,
      value: this.value,
      cycles: this.cycles
    };
  }

  set({ speed, saturation, value, cycles }: Partial<RainbowProps>) {
    this.speed = speed ?? this.speed;
    this.saturation = saturation ?? this.saturation;
    this.value = value ?? this.value;
    this.cycles = cycles ?? this.cycles;
    this.render();
  }

  advance(dt: number) {
    this.phase += this.speed * dt;
    this.render();
  }

  private render() {
    const n = this.state.length;
    for (let i = 0; i < n; i++) {
      const hue = (i / n) * 360 * this.cycles + this.phase;
      const { r, g, b } = hsvToRgb(hue, this.saturation, this.value);
      this.state[i] = { r, g, b, a: 1 };
    }
  }
}
