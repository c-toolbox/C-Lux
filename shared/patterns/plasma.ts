import {
  type Color,
  hsvToRgb,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE,
  rgbToHsv
} from './pattern.ts';

export type PlasmaProps = PatternBaseProps &
  Color & {
    // Hue range in degrees, centered on the color's hue, scale in whole turns of the
    // ring and speed in turns per second.
    hueRange: number;
    scale: number;
    speed: number;
  };

const TAU = 2 * Math.PI;

const DEGREES = { min: 0, max: 360 };

export class PlasmaPattern extends Pattern {
  static readonly Type = 'Plasma';
  static readonly DisplayName = 'Plasma';
  static readonly Fields = {
    color: {
      kind: 'color',
      label: 'Color',
      default: { r: 140, g: 26, b: 255 },
      hint: 'Center color of the palette; the hue range spreads around its hue.'
    },
    hueRange: {
      kind: 'number',
      label: 'Hue range (°)',
      hint: 'How far the colors stray from the center hue.',
      default: 140,
      step: 10,
      ...DEGREES
    },
    scale: {
      kind: 'number',
      label: 'Scale (turns)',
      hint: 'How many times the pattern repeats around the ring; higher gives smaller blobs.',
      // Rounded to whole turns of the ring so the field stays continuous across the seam.
      default: 2,
      step: 1,
      row: 1,
      ...POSITIVE
    },
    speed: {
      kind: 'number',
      label: 'Speed (turns/s)',
      hint: 'How fast the plasma moves.',
      default: 0.06,
      step: 0.01,
      row: 1
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  a = 1;
  hueRange!: number;
  scale!: number;
  speed!: number;

  private time = 0;

  constructor(props: PlasmaProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof PlasmaPattern.Type;
    color: Color;
    hueRange: number;
    scale: number;
    speed: number;
  } {
    return {
      name: this.name,
      type: PlasmaPattern.Type,
      color: { r: this.r, g: this.g, b: this.b, a: this.a },
      hueRange: this.hueRange,
      scale: this.scale,
      speed: this.speed
    };
  }

  set({ r, g, b, a, hueRange, scale, speed }: Partial<PlasmaProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.a = a ?? this.a;
    this.hueRange = hueRange ?? this.hueRange;
    this.scale = scale ?? this.scale;
    this.speed = speed ?? this.speed;
    this.render();
  }

  tick(dt: number) {
    this.time += dt;
    this.render();
  }

  private render() {
    const n = this.state.length;
    const { h, s, v } = rgbToHsv(this);
    const k1 = Math.max(1, Math.round(this.scale));
    const k2 = Math.max(k1 + 1, Math.round(1.6 * this.scale));
    const k3 = Math.max(k2 + 1, Math.round(2.3 * this.scale));
    for (let i = 0; i < n; i++) {
      const x = i / n;
      // Three sines drifting at unrelated rates, so the field never repeats exactly.
      const w =
        0.5 * Math.sin(TAU * (k1 * x + this.speed * this.time)) +
        0.3 * Math.sin(TAU * (k2 * x - 0.73 * this.speed * this.time) + 1.7) +
        0.2 * Math.sin(TAU * (k3 * x + 0.41 * this.speed * this.time) + 4.1);
      const hue = h + this.hueRange * 0.5 * w;
      this.state[i] = { ...hsvToRgb(hue, s, v), a: this.a };
    }
  }
}
