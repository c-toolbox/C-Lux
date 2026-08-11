import { type Color, Pattern, type PatternBaseProps } from './pattern.ts';

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

  advance(dt: number) {
    this.phase += this.speed * this.state.length * dt;
    this.render();
  }

  private render() {
    const n = this.state.length;
    const wl = this.wavelength > 0 ? this.wavelength * n : 1;
    for (let i = 0; i < n; i++) {
      const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * (i - this.phase)) / wl);
      const a = this.min + (this.max - this.min) * wave;
      this.state[i] = { r: this.r, g: this.g, b: this.b, a };
    }
  }
}
