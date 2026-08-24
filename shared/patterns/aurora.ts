import {
  ANY,
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE,
  UNIT
} from './pattern.ts';

export type AuroraProps = PatternBaseProps &
  Color & {
    color2: Color;
    // Drift in full turns per second and the number of curtains across the ring.
    speed: number;
    scale: number;
    intensity: number;
  };

const TAU = 2 * Math.PI;

export class AuroraPattern extends Pattern {
  static readonly Type = 'Aurora';
  static readonly DisplayName = 'Aurora';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color A', default: { r: 43, g: 212, b: 125 } },
    color2: { kind: 'color', label: 'Color B', default: { r: 112, g: 72, b: 232 } },
    speed: {
      kind: 'number',
      label: 'Drift (turns/s)',
      default: 0.05,
      step: 0.01,
      row: 0,
      ...ANY
    },
    scale: {
      kind: 'number',
      label: 'Curtains',
      default: 2,
      // Rounded to whole turns of the ring so the field stays continuous across the seam.
      step: 1,
      row: 0,
      ...POSITIVE
    },
    intensity: {
      kind: 'number',
      label: 'Intensity',
      default: 1,
      step: 0.05,
      row: 0,
      ...UNIT
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  color2!: Color;
  speed!: number;
  scale!: number;
  intensity!: number;

  private time = 0;

  constructor(props: AuroraProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof AuroraPattern.Type;
    color: Color;
    color2: Color;
    speed: number;
    scale: number;
    intensity: number;
  } {
    return {
      name: this.name,
      type: AuroraPattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      color2: this.color2,
      speed: this.speed,
      scale: this.scale,
      intensity: this.intensity
    };
  }

  set({ r, g, b, color2, speed, scale, intensity }: Partial<AuroraProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.color2 = color2 ?? this.color2;
    this.speed = speed ?? this.speed;
    this.scale = scale ?? this.scale;
    this.intensity = intensity ?? this.intensity;
    this.render();
  }

  advance(dt: number) {
    this.time += dt;
    this.render();
  }

  private render() {
    const n = this.state.length;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const curtain = field(x, this.time, this.scale, this.speed, 0);
      // A slower, wider field shifts the hue independently of the curtain brightness.
      const mix = field(x, this.time, this.scale * 0.6, this.speed * 0.45, 2.1);
      this.state[i] = {
        r: lerp(this.r, this.color2.r, mix),
        g: lerp(this.g, this.color2.g, mix),
        b: lerp(this.b, this.color2.b, mix),
        // Squaring sharpens the bright bands and darkens the gaps between them.
        a: this.intensity * curtain * curtain
      };
    }
  }
}

// Three sines drifting at different rates, so the bands never repeat exactly. Their
// wavenumbers are whole turns of the ring so the field is continuous across the seam at
// x = 0, and their drift rates are incommensurable so the sum still evolves. Returns a
// value in [0, 1].
function field(
  x: number,
  t: number,
  scale: number,
  speed: number,
  phase: number
): number {
  const k1 = Math.max(1, Math.round(scale));
  const k2 = Math.max(k1 + 1, Math.round(1.7 * scale));
  const k3 = Math.max(k2 + 1, Math.round(2.9 * scale));
  const w =
    0.5 * Math.sin(TAU * (k1 * x + speed * t) + phase) +
    0.3 * Math.sin(TAU * (k2 * x - 0.6 * speed * t) + phase + 1.3) +
    0.2 * Math.sin(TAU * (k3 * x + 0.35 * speed * t) + phase + 2.7);
  return 0.5 + 0.5 * w;
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}
