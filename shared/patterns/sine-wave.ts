import {
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE_UNIT,
  UNIT
} from './pattern.ts';

export type SineWaveProps = PatternBaseProps &
  Color & {
    // Wavelength is a fraction of the ring and speed is in full turns per second.
    wavelength: number;
    speed: number;
    min: number;
    max: number;
  };

export class SineWavePattern extends Pattern {
  static readonly Type = 'SineWave';
  static readonly DisplayName = 'Sine Wave';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color', default: { r: 77, g: 171, b: 247 } },
    wavelength: {
      kind: 'number',
      label: 'Wavelength (fraction)',
      default: 0.14,
      step: 0.01,
      row: 0,
      hint: 'Rounded to fit a whole number of waves around the ring.',
      ...POSITIVE_UNIT
    },
    speed: {
      kind: 'number',
      label: 'Speed (turns/s)',
      default: 0.07,
      step: 0.05,
      row: 0
    },
    min: { kind: 'number', label: 'Min', default: 0, step: 0.05, row: 1, ...UNIT },
    max: { kind: 'number', label: 'Max', default: 1, step: 0.05, row: 1, ...UNIT }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  wavelength!: number;
  speed!: number;
  min!: number;
  max!: number;

  // Travelling-wave phase, measured in lights.
  private phase = 0;

  constructor(props: SineWaveProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof SineWavePattern.Type;
    color: Color;
    wavelength: number;
    speed: number;
    min: number;
    max: number;
  } {
    return {
      name: this.name,
      type: SineWavePattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      wavelength: this.wavelength,
      speed: this.speed,
      min: this.min,
      max: this.max
    };
  }

  set({ r, g, b, wavelength, speed, min, max }: Partial<SineWaveProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.wavelength = wavelength ?? this.wavelength;
    this.speed = speed ?? this.speed;
    this.min = min ?? this.min;
    this.max = max ?? this.max;
    this.render();
  }

  tick(dt: number) {
    const n = this.state.length;
    this.phase = (((this.phase + this.speed * n * dt) % n) + n) % n;
    this.render();
  }

  private render() {
    const n = this.state.length;
    // Snap to a whole number of waves around the ring, otherwise the wave is cut off
    // where the last light meets the first one.
    const cycles = this.wavelength > 0 ? Math.max(1, Math.round(1 / this.wavelength)) : 1;
    const wl = n / cycles;
    for (let i = 0; i < n; i++) {
      const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * (i - this.phase)) / wl);
      const a = this.min + (this.max - this.min) * wave;
      this.state[i] = { r: this.r, g: this.g, b: this.b, a };
    }
  }
}
