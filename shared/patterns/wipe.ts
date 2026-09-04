import {
  type Color,
  NON_NEGATIVE,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE
} from './pattern.ts';

export type WipeProps = PatternBaseProps &
  Color & {
    color2: Color;
    // Speed in full turns per second and the pause between wipes in seconds.
    speed: number;
    hold: number;
    direction: number;
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
      default: 0.5,
      step: 0.1,
      row: 0,
      hint: 'Pause once the ring is a single color.',
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
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  color2!: Color;
  speed!: number;
  hold!: number;
  direction!: number;

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
  } {
    return {
      name: this.name,
      type: WipePattern.Type,
      color: { r: this.r, g: this.g, b: this.b },
      color2: this.color2,
      speed: this.speed,
      hold: this.hold,
      direction: this.direction
    };
  }

  set({ r, g, b, color2, speed, hold, direction }: Partial<WipeProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.color2 = color2 ?? this.color2;
    this.speed = speed ?? this.speed;
    this.hold = hold ?? this.hold;
    this.direction = direction ?? this.direction;
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
      // The ring is now a single color; swap the roles and wait before the next wipe.
      this.progress = 0;
      this.painting = this.painting === 1 ? 0 : 1;
      this.holdTimer = this.hold;
    }
    this.render();
  }

  private render() {
    const n = this.state.length;
    const colorA = { r: this.r, g: this.g, b: this.b };
    const incoming = this.painting === 0 ? colorA : this.color2;
    const outgoing = this.painting === 0 ? this.color2 : colorA;
    for (let i = 0; i < n; i++) {
      // Backward wipes sweep from the far end, so the front reaches light 0 last.
      const swept = this.direction >= 0 ? i : n - 1 - i;
      this.state[i] = { ...(swept < this.progress ? incoming : outgoing), a: 1 };
    }
  }
}
