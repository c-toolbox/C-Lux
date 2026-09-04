import {
  hsvToRgb,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE,
  UNIT
} from './pattern.ts';

export type PlasmaProps = PatternBaseProps & {
  // Hue and hue range in degrees, scale in whole turns of the ring and speed in turns
  // per second.
  hue: number;
  hueRange: number;
  scale: number;
  speed: number;
  saturation: number;
};

const TAU = 2 * Math.PI;

const DEGREES = { min: 0, max: 360 };

export class PlasmaPattern extends Pattern {
  static readonly Type = 'Plasma';
  static readonly DisplayName = 'Plasma';
  static readonly Fields = {
    hue: { kind: 'number', label: 'Hue (°)', default: 200, step: 10, row: 0, ...DEGREES },
    hueRange: {
      kind: 'number',
      label: 'Hue range (°)',
      default: 140,
      step: 10,
      row: 0,
      ...DEGREES
    },
    scale: {
      kind: 'number',
      label: 'Scale (turns)',
      // Rounded to whole turns of the ring so the field stays continuous across the seam.
      default: 2,
      step: 1,
      row: 1,
      ...POSITIVE
    },
    speed: {
      kind: 'number',
      label: 'Speed (turns/s)',
      default: 0.06,
      step: 0.01,
      row: 1
    },
    saturation: {
      kind: 'number',
      label: 'Saturation',
      default: 0.9,
      step: 0.05,
      row: 1,
      ...UNIT
    }
  } satisfies PatternSchema;

  hue!: number;
  hueRange!: number;
  scale!: number;
  speed!: number;
  saturation!: number;

  private time = 0;

  constructor(props: PlasmaProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof PlasmaPattern.Type;
    hue: number;
    hueRange: number;
    scale: number;
    speed: number;
    saturation: number;
  } {
    return {
      name: this.name,
      type: PlasmaPattern.Type,
      hue: this.hue,
      hueRange: this.hueRange,
      scale: this.scale,
      speed: this.speed,
      saturation: this.saturation
    };
  }

  set({ hue, hueRange, scale, speed, saturation }: Partial<PlasmaProps>) {
    this.hue = hue ?? this.hue;
    this.hueRange = hueRange ?? this.hueRange;
    this.scale = scale ?? this.scale;
    this.speed = speed ?? this.speed;
    this.saturation = saturation ?? this.saturation;
    this.render();
  }

  tick(dt: number) {
    this.time += dt;
    this.render();
  }

  private render() {
    const n = this.state.length;
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
      const hue = this.hue + this.hueRange * (0.5 + 0.5 * w);
      this.state[i] = { ...hsvToRgb(hue, this.saturation, 1), a: 1 };
    }
  }
}
