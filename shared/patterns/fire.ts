import {
  type Color,
  NON_NEGATIVE,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  UNIT
} from './pattern.ts';

export type FireProps = PatternBaseProps & {
  cooling: number;
  sparking: number;
};

// Fixed simulation step so the fire looks the same regardless of frame time.
const STEP = 1 / 30;

export class FirePattern extends Pattern {
  static readonly Type = 'Fire';
  static readonly DisplayName = 'Fire';
  static readonly Fields = {
    cooling: {
      kind: 'number',
      label: 'Cooling',
      default: 55,
      step: 5,
      row: 0,
      ...NON_NEGATIVE
    },
    sparking: {
      kind: 'number',
      label: 'Sparking',
      default: 0.6,
      step: 0.05,
      row: 0,
      ...UNIT
    }
  } satisfies PatternSchema;

  cooling!: number;
  sparking!: number;

  // Per-light heat in [0, 255]; higher is hotter and brighter. Only half the strip is
  // simulated: index 0 is the flame base at the front of the dome (light 0) and higher
  // indices reach around the ring toward the back. Both halves are mirrored from this
  // array when rendering.
  private heat: number[] = Array.from(
    { length: Math.ceil(this.state.length / 2) },
    () => 0
  );
  private accumulator = 0;

  constructor(props: FireProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof FirePattern.Type;
    cooling: number;
    sparking: number;
  } {
    return {
      name: this.name,
      type: FirePattern.Type,
      cooling: this.cooling,
      sparking: this.sparking
    };
  }

  set({ cooling, sparking }: Partial<FireProps>) {
    this.cooling = cooling ?? this.cooling;
    this.sparking = sparking ?? this.sparking;
    this.render();
  }

  tick(dt: number) {
    this.accumulator += dt;
    while (this.accumulator >= STEP) {
      this.step();
      this.accumulator -= STEP;
    }
    this.render();
  }

  // One iteration of the classic Fire2012 heat simulation.
  private step() {
    const n = this.heat.length;

    // Cool every cell by a random amount.
    for (let i = 0; i < n; i++) {
      const cooldown = Math.random() * ((this.cooling * 10) / n + 2);
      this.heat[i] = Math.max(0, this.heat[i] - cooldown);
    }

    // Heat drifts upward and diffuses.
    for (let k = n - 1; k >= 2; k--) {
      this.heat[k] = (this.heat[k - 1] + this.heat[k - 2] + this.heat[k - 2]) / 3;
    }

    // Randomly ignite new sparks near the base.
    if (Math.random() < this.sparking) {
      const y = Math.floor(Math.random() * Math.min(7, n));
      this.heat[y] = Math.min(255, this.heat[y] + 160 + Math.random() * 95);
    }
  }

  private render() {
    const n = this.state.length;
    const mid = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
      // Distance from light 0, measured around the ring, maps onto the simulated half.
      const h = i < mid ? i : n - 1 - i;
      this.state[i] = { ...heatColor(this.heat[h] ?? 0), a: 1 };
    }
  }
}

// Map a heat value in [0, 255] onto a black-red-orange-yellow-white ramp.
function heatColor(heat: number): Color {
  const t192 = Math.round((Math.max(0, Math.min(255, heat)) / 255) * 191);
  const ramp = (t192 & 0x3f) << 2; // 0..252
  if (t192 & 0x80) return { r: 255, g: 255, b: ramp };
  if (t192 & 0x40) return { r: 255, g: ramp, b: 0 };
  return { r: ramp, g: 0, b: 0 };
}
