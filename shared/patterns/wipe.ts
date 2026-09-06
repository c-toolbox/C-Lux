import {
  type Color,
  NON_NEGATIVE,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE,
  UNIT
} from './pattern.ts';

export type WipeProps = PatternBaseProps &
  Color & {
    color2: Color;
    // Speed in full turns per second and the pause between wipes in seconds.
    speed: number;
    hold: number;
    direction: number;
    // Fractions of the ring: how wide the edges fade and where the wipe starts.
    blur: number;
    origin: number;
  };

export class WipePattern extends Pattern {
  static readonly Type = 'Wipe';
  static readonly DisplayName = 'Wipe';
  static readonly Fields = {
    color: { kind: 'color', label: 'Color A', default: { r: 255, g: 255, b: 255 } },
    color2: { kind: 'color', label: 'Color B', default: { r: 34, g: 139, b: 230 } },
    speed: {
      kind: 'number',
      label: 'Speed (turns/s)',
      default: 0.3,
      step: 0.05,
      row: 0,
      ...POSITIVE
    },
    hold: {
      kind: 'number',
      label: 'Hold (s)',
      default: 0,
      step: 0.1,
      row: 0,
      hint: 'Pause once the ring is back to color A.',
      ...NON_NEGATIVE
    },
    direction: {
      kind: 'select',
      label: 'Direction',
      default: 1,
      options: [
        { value: 1, label: 'Forward' },
        { value: -1, label: 'Backward' }
      ]
    },
    blur: {
      kind: 'number',
      label: 'Blur (fraction)',
      default: 0.05,
      step: 0.01,
      row: 1,
      hint: 'How wide the moving edge fades from one color to the other.',
      ...UNIT
    },
    origin: {
      kind: 'number',
      label: 'Origin (fraction)',
      default: 0,
      step: 0.05,
      row: 1,
      ...UNIT
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  color2!: Color;
  speed!: number;
  hold!: number;
  direction!: number;

  // Patterns stored before these existed fall back to a hard edge starting at light 0.
  blur = 0;
  origin = 0;

  // How far the front has swept, in lights, and which color it is laying down.
  private progress = 0;
  private painting = 1;
  private holdTimer = 0;

  constructor(props: WipeProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof WipePattern.Type;
    color: Color;
    color2: Color;
    speed: number;
    hold: number;
    direction: number;
    blur: number;
    origin: number;
  } {
    return {
      name: this.name,
      type: WipePattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      color2: this.color2,
      speed: this.speed,
      hold: this.hold,
      direction: this.direction,
      blur: this.blur,
      origin: this.origin
    };
  }

  set({ r, g, b, color2, speed, hold, direction, blur, origin }: Partial<WipeProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.color2 = color2 ?? this.color2;
    this.speed = speed ?? this.speed;
    this.hold = hold ?? this.hold;
    this.direction = direction ?? this.direction;
    this.blur = blur ?? this.blur;
    this.origin = origin ?? this.origin;
    this.render();
  }

  tick(dt: number) {
    if (this.holdTimer > 0) {
      this.holdTimer -= dt;
      return;
    }

    const n = this.state.length;
    this.progress += this.speed * n * dt;
    if (this.progress >= n) {
      // The front is back at the origin; swap the roles. Only a finished color A wipe
      // pauses, so color B hands straight back over to color A.
      const finishedA = this.painting === 0;
      this.progress -= n;
      this.painting = finishedA ? 1 : 0;
      if (finishedA) this.holdTimer = this.hold;
    }
    this.render();
  }

  private render() {
    const n = this.state.length;
    const colorA = { r: this.r, g: this.g, b: this.b };
    const incoming = this.painting === 0 ? colorA : this.color2;
    const outgoing = this.painting === 0 ? this.color2 : colorA;
    const { progress } = this;
    const width = this.blur * n;
    const start = this.origin * n;
    for (let i = 0; i < n; i++) {
      // Distance of the light's center from the origin along the sweep, so the front
      // sits at `progress` for both directions.
      const swept = mod(this.direction >= 0 ? i - start : start - i, n) + 0.5;
      // Phase behind the front over the two-turn cycle: incoming fills the first turn,
      // outgoing the second. The ring spans exactly half of that, so it carries a
      // single edge that keeps its full width as it crosses the origin - the tail
      // leaves the seam just as the head of the next turn arrives there.
      const phase = mod(progress - swept, 2 * n);
      const turn = phase < n ? phase : phase - n;
      const ramp = width > 0 ? clamp01(Math.min(turn, n - turn) / width + 0.5) : 1;
      const mix = phase < n ? ramp : 1 - ramp;
      this.state[i] = {
        r: Math.round(outgoing.r + (incoming.r - outgoing.r) * mix),
        g: Math.round(outgoing.g + (incoming.g - outgoing.g) * mix),
        b: Math.round(outgoing.b + (incoming.b - outgoing.b) * mix),
        a: 1
      };
    }
  }
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
