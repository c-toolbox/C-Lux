import {
  type Color,
  NON_NEGATIVE,
  Pattern,
  type PatternBaseProps,
  type PatternSchema,
  POSITIVE,
  POSITIVE_UNIT,
  UNIT
} from './pattern.ts';

export type LightningProps = PatternBaseProps &
  Color & {
    // Strikes per second, the most flashes one strike can fire, the share of the ring a
    // strike covers, how long each flash takes to rise, how fast it fades and how far
    // its ends taper off.
    rate: number;
    flashes: number;
    coverage: number;
    attack: number;
    decay: number;
    softness: number;
  };

export class LightningPattern extends Pattern {
  static readonly Type = 'Lightning';
  static readonly DisplayName = 'Lightning';
  static readonly Fields = {
    color: {
      kind: 'color',
      label: 'Color',
      default: { r: 200, g: 220, b: 255 },
      hint: 'Color of the flashes.'
    },
    rate: {
      kind: 'number',
      label: 'Strikes (per s)',
      hint: 'Average number of strikes per second.',
      default: 0.4,
      step: 0.1,
      row: 0,
      ...POSITIVE
    },
    flashes: {
      kind: 'number',
      label: 'Flashes',
      default: 3,
      step: 1,
      row: 0,
      hint: 'Upper bound; each strike fires a random number up to this.',
      min: 1,
      max: 10
    },
    attack: {
      kind: 'number',
      label: 'Fade in (s)',
      default: 0.05,
      step: 0.01,
      row: 1,
      hint: 'Time a flash takes to reach full brightness; 0 lights it instantly.',
      ...NON_NEGATIVE
    },
    decay: {
      kind: 'number',
      label: 'Decay',
      hint: 'How fast each flash fades; higher is snappier.',
      default: 8,
      step: 0.5,
      row: 1,
      ...POSITIVE
    },
    coverage: {
      kind: 'number',
      label: 'Coverage (fraction)',
      hint: 'Share of the ring a single strike lights.',
      default: 0.4,
      step: 0.05,
      row: 2,
      ...POSITIVE_UNIT
    },
    softness: {
      kind: 'number',
      label: 'Softness',
      default: 0.35,
      step: 0.05,
      row: 2,
      hint: "Share of a strike's arc that fades out at each end; 0 cuts off sharply.",
      ...UNIT
    }
  } satisfies PatternSchema;

  r!: number;
  g!: number;
  b!: number;
  a = 1;
  rate!: number;
  flashes!: number;
  coverage!: number;
  attack!: number;
  decay!: number;
  softness!: number;

  // The arc the current strike lights, the brightness the current flash rises to, its
  // remaining flashes and the countdown to the next flash or, once a strike is spent,
  // to the next strike.
  private start = 0;
  private span = 0;
  private intensity = 0;
  private peak = 0;
  private rising = false;
  private remaining = 0;
  private timer = 0;

  constructor(props: LightningProps) {
    super(props);
    this.set(props);
    this.timer = this.nextStrike();
  }

  parameters(): {
    name: string;
    type: typeof LightningPattern.Type;
    color: Color;
    rate: number;
    flashes: number;
    coverage: number;
    attack: number;
    decay: number;
    softness: number;
  } {
    return {
      name: this.name,
      type: LightningPattern.Type,
      color: { r: this.r, g: this.g, b: this.b, a: this.a },
      rate: this.rate,
      flashes: this.flashes,
      coverage: this.coverage,
      attack: this.attack,
      decay: this.decay,
      softness: this.softness
    };
  }

  set({
    r,
    g,
    b,
    a,
    rate,
    flashes,
    coverage,
    attack,
    decay,
    softness
  }: Partial<LightningProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.a = a ?? this.a;
    this.rate = rate ?? this.rate;
    this.flashes = flashes ?? this.flashes;
    this.coverage = coverage ?? this.coverage;
    this.attack = attack ?? this.attack;
    this.decay = decay ?? this.decay;
    this.softness = softness ?? this.softness;
    this.render();
  }

  tick(dt: number) {
    if (this.rising) {
      this.intensity = Math.min(
        this.peak,
        this.intensity + (this.peak * dt) / this.attack
      );
      if (this.intensity >= this.peak) this.rising = false;
    } else {
      this.intensity *= Math.exp(-this.decay * dt);
    }

    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.remaining <= 0) this.strike();
      this.flash();
    }

    this.render();
  }

  // Pick the arc this strike lights and how many flashes it fires.
  private strike() {
    const n = this.state.length;
    this.start = Math.floor(Math.random() * n);
    this.span = Math.max(1, Math.round(this.coverage * n * (0.5 + Math.random() * 0.5)));
    this.remaining =
      1 + Math.floor(Math.random() * Math.max(1, Math.round(this.flashes)));
  }

  private flash() {
    this.peak = 0.6 + 0.4 * Math.random();
    // Rise from the current brightness so a follow-up flash doesn't dip first.
    this.rising = this.attack > 0 && this.intensity < this.peak;
    if (!this.rising) this.intensity = this.peak;
    this.remaining -= 1;
    // Flashes within a strike come in a quick stutter; strikes themselves are spaced by
    // a random wait, so the storm never falls into a rhythm.
    this.timer = this.remaining > 0 ? 0.04 + Math.random() * 0.12 : this.nextStrike();
  }

  // Time until the next strike, drawn so that `rate` strikes happen per second on
  // average but never at a fixed interval.
  private nextStrike(): number {
    return -Math.log(1 - Math.random()) / this.rate;
  }

  private render() {
    const n = this.state.length;
    // Ramp the intensity toward both ends of the arc so a strike fades out along the ring
    // instead of cutting off.
    const edge = this.span * this.softness;
    for (let i = 0; i < n; i++) {
      const offset = (i - this.start + n) % n;
      const distance = Math.min(offset, this.span - 1 - offset) + 0.5;
      const ramp = edge > 0 ? Math.min(1, distance / edge) : 1;
      const a = offset < this.span ? this.a * this.intensity * ramp : 0;
      this.state[i] = { r: this.r, g: this.g, b: this.b, a };
    }
  }
}
