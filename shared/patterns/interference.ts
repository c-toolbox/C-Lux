import {
  type Color,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE
} from './pattern.ts';

export type InterferenceProps = PatternBaseProps &
  Color & {
    color2: Color;
    // Wave counts are whole turns of the ring; speeds are in turns per second and may be
    // negative to send a wave the other way.
    waves: number;
    waves2: number;
    speed: number;
    speed2: number;
  };

const TAU = 2 * Math.PI;

export class InterferencePattern extends Pattern {
  static readonly Type = 'Interference';
  static readonly DisplayName = 'Interference';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color A', default: { r: 34, g: 139, b: 230 } },
    color2: { kind: 'color', label: 'Color B', default: { r: 250, g: 82, b: 82 } },
    waves: {
      kind: 'number',
      label: 'Waves A',
      default: 3,
      step: 1,
      row: 0,
      ...POSITIVE
    },
    waves2: {
      kind: 'number',
      label: 'Waves B',
      default: 4,
      step: 1,
      row: 0,
      hint: 'Two counts close together make the beat pattern drift slowly.',
      ...POSITIVE
    },
    speed: {
      kind: 'number',
      label: 'Speed A (turns/s)',
      default: 0.08,
      step: 0.01,
      row: 1
    },
    speed2: {
      kind: 'number',
      label: 'Speed B (turns/s)',
      default: -0.05,
      step: 0.01,
      row: 1
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  color2!: Color;
  waves!: number;
  waves2!: number;
  speed!: number;
  speed2!: number;

  private time = 0;

  constructor(props: InterferenceProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof InterferencePattern.Type;
    color: Color;
    color2: Color;
    waves: number;
    waves2: number;
    speed: number;
    speed2: number;
  } {
    return {
      name: this.name,
      type: InterferencePattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      color2: this.color2,
      waves: this.waves,
      waves2: this.waves2,
      speed: this.speed,
      speed2: this.speed2
    };
  }

  set({ r, g, b, color2, waves, waves2, speed, speed2 }: Partial<InterferenceProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.color2 = color2 ?? this.color2;
    this.waves = waves ?? this.waves;
    this.waves2 = waves2 ?? this.waves2;
    this.speed = speed ?? this.speed;
    this.speed2 = speed2 ?? this.speed2;
    this.render();
  }

  tick(dt: number) {
    this.time += dt;
    this.render();
  }

  private render() {
    const n = this.state.length;
    // Whole wave counts keep both waves continuous across the seam at light 0.
    const k1 = Math.max(1, Math.round(this.waves));
    const k2 = Math.max(1, Math.round(this.waves2));
    for (let i = 0; i < n; i++) {
      const x = i / n;
      // Only the crests are lit, so the two waves cross rather than wash into each
      // other, and their overlaps stack into brighter, blended nodes.
      const v1 = Math.max(0, Math.sin(TAU * (k1 * x + this.speed * this.time)));
      const v2 = Math.max(0, Math.sin(TAU * (k2 * x + this.speed2 * this.time)));
      this.state[i] = {
        r: Math.round(Math.min(255, this.r * v1 + this.color2.r * v2)),
        g: Math.round(Math.min(255, this.g * v1 + this.color2.g * v2)),
        b: Math.round(Math.min(255, this.b * v1 + this.color2.b * v2)),
        a: Math.min(1, v1 + v2)
      };
    }
  }
}
