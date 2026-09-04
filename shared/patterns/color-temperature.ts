import {
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  UNIT
} from './pattern.ts';

export type ColorTemperatureProps = PatternBaseProps & {
  // Correlated color temperature in kelvin: low is candle-warm, high is daylight-blue.
  kelvin: number;
  brightness: number;
};

export class ColorTemperaturePattern extends Pattern {
  static readonly Type = 'ColorTemperature';
  static readonly DisplayName = 'Color Temperature';
  static readonly Fields = {
    kelvin: {
      kind: 'number',
      label: 'Temperature (K)',
      default: 2700,
      step: 100,
      row: 0,
      hint: '2700 K is a warm bulb, 6500 K is daylight.',
      min: 1000,
      max: 12000
    },
    brightness: {
      kind: 'number',
      label: 'Brightness',
      default: 1,
      step: 0.05,
      row: 0,
      ...UNIT
    }
  } satisfies PatternSchema;

  kelvin!: number;
  brightness!: number;

  constructor(props: ColorTemperatureProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof ColorTemperaturePattern.Type;
    kelvin: number;
    brightness: number;
  } {
    return {
      name: this.name,
      type: ColorTemperaturePattern.Type,
      kelvin: this.kelvin,
      brightness: this.brightness
    };
  }

  set({ kelvin, brightness }: Partial<ColorTemperatureProps>) {
    this.kelvin = kelvin ?? this.kelvin;
    this.brightness = brightness ?? this.brightness;
    this.render();
  }

  // The white point never changes on its own, so there is nothing to advance.
  tick(_dt: number) {}

  private render() {
    const white = kelvinToRgb(this.kelvin);
    // Dimming scales the color rather than the alpha, so the layer keeps covering the
    // ones below it instead of letting them show through as it darkens.
    const color = {
      r: Math.round(white.r * this.brightness),
      g: Math.round(white.g * this.brightness),
      b: Math.round(white.b * this.brightness)
    };
    for (let i = 0; i < this.state.length; i++) {
      this.state[i] = { ...color, a: 1 };
    }
  }
}

// Tanner Helland's approximation of the black-body locus, accurate enough over the
// 1000-12000 K range the field allows.
function kelvinToRgb(kelvin: number): Color {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  if (t <= 66) {
    return {
      r: 255,
      g: byte(99.4708025861 * Math.log(t) - 161.1195681661),
      b: t <= 19 ? 0 : byte(138.5177312231 * Math.log(t - 10) - 305.0447927307)
    };
  }
  return {
    r: byte(329.698727446 * Math.pow(t - 60, -0.1332047592)),
    g: byte(288.1221695283 * Math.pow(t - 60, -0.0755148492)),
    b: 255
  };
}

function byte(value: number): number {
  return Math.round(Math.min(255, Math.max(0, value)));
}
