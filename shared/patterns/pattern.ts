import config from '../../config.json' with { type: 'json' };

export interface Color {
  r: number;
  g: number;
  b: number;
}

// Internal per-light color carrying an alpha channel in [0, 1] used for blending.
interface ColorAlpha extends Color {
  a: number;
}

export interface PatternBaseProps {
  name: string;
  // Disabled patterns stay in the list but are skipped when blending. Defaults to true.
  enabled?: boolean;
  // Scales the alpha of every light of the pattern when it is blended. Defaults to 1.
  opacity?: number;
  // How the pattern combines with the layers below it, a `BlendMode`. Defaults to Alpha.
  blendMode?: number;
}

// How a layer is composited onto the ones beneath it. Stored as numbers so they can be
// used as `select` option values.
export const BlendMode = {
  Alpha: 0,
  Additive: 1,
  Multiply: 2,
  Subtract: 3
} as const;

export interface NumberRange {
  min?: number;
  max?: number;
  exclusiveMin?: number;
}

interface FieldBase {
  label: string;
  // Fields sharing a row number are rendered side by side; omitting it spans the width.
  row?: number;
  hint?: string;
}

// A single configurable parameter of a pattern, carrying enough metadata to both
// validate an incoming value on the server and render an input for it in the browser.
export type FieldSpec =
  | (FieldBase & NumberRange & { kind: 'number'; default: number; step?: number })
  | (FieldBase & NumberRange & { kind: 'slider'; default: number; step?: number })
  | (FieldBase & { kind: 'color'; default: Color })
  | (FieldBase & { kind: 'colors'; default: Color[] })
  | (FieldBase & {
      kind: 'select';
      default: number;
      options: ReadonlyArray<{ value: number; label: string }>;
    });

// Upper bound on a `colors` palette, so a request can't carry an unbounded list.
export const MAX_COLORS = 16;

// Every configurable parameter of a pattern, keyed by the name it has in `parameters()`
// (so `color` / `color2` rather than the flat r/g/b constructor props).
export type PatternSchema = Record<string, FieldSpec>;

export const UNIT: NumberRange = { min: 0, max: 1 };
export const NON_NEGATIVE: NumberRange = { min: 0 };
export const POSITIVE: NumberRange = { exclusiveMin: 0 };

// Lengths and positions are fractions of the ring, so they span (0, 1].
export const POSITIVE_UNIT: NumberRange = { exclusiveMin: 0, max: 1 };

// Parameters the base class owns rather than any single pattern. They are appended to
// every pattern's own `Fields`, so the editor shows them and the server validates them
// like the rest. Patterns stored before a shared field existed simply fall back to its
// default, so these stay optional even when creating a pattern.
export const SHARED_FIELDS = {
  opacity: {
    kind: 'slider',
    label: 'Opacity',
    hint: 'How strongly this pattern covers the ones below it',
    default: 1,
    step: 0.01,
    ...UNIT
  },
  blendMode: {
    kind: 'select',
    label: 'Blend mode',
    hint: 'How this pattern combines with the ones below it',
    default: BlendMode.Alpha,
    options: [
      { value: BlendMode.Alpha, label: 'Alpha blending' },
      { value: BlendMode.Additive, label: 'Additive' },
      { value: BlendMode.Multiply, label: 'Multiplication' },
      { value: BlendMode.Subtract, label: 'Subtraction' }
    ]
  }
} satisfies PatternSchema;

// Convert HSV (h in degrees, s and v in [0, 1]) to 8-bit RGB.
export function hsvToRgb(h: number, s: number, v: number): Color {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

// The parameter values a pattern eases between after an edit: `from` is what was on
// the lights when the change was committed, `to` the committed values, and `elapsed`
// how far into `duration` seconds the ease has run.
interface ParameterFade {
  from: Record<string, unknown>;
  to: Record<string, unknown>;
  elapsed: number;
  duration: number;
}

// A parameter value shaped like a color: a plain object with numeric r, g and b.
function isColor(value: unknown): value is Color {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number';
}

// Whether two committed parameter sets differ in anything the lights would show.
function parametersDiffer(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(b)) {
    if (key === 'name' || key === 'type') continue;
    if (!valueEquals(a[key], value)) return true;
  }
  return false;
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, i) => valueEquals(entry, b[i]));
  }
  if (isColor(a) && isColor(b)) return a.r === b.r && a.g === b.g && a.b === b.b;
  return a === b;
}

// The parameters a pattern should show at progress `t` between two committed sets,
// keyed like `parameters()` output. `name` and `type` pass through untouched.
function interpolateParameters(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  t: number,
  fields: PatternSchema
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, target] of Object.entries(to)) {
    if (key === 'name' || key === 'type') out[key] = target;
    else out[key] = interpolateValue(from[key], target, t, fields[key]?.kind);
  }
  return out;
}

// Ease one parameter value, using the field's kind to decide how: numbers and colors
// lerp, palettes lerp color by color (and snap when their length changed), and
// discrete selects snap outright because they have no meaningful in-between.
function interpolateValue(
  from: unknown,
  to: unknown,
  t: number,
  kind: FieldSpec['kind'] | undefined
): unknown {
  if (kind === 'select') return to;
  if (kind === 'color' && isColor(from) && isColor(to)) {
    return {
      r: from.r + (to.r - from.r) * t,
      g: from.g + (to.g - from.g) * t,
      b: from.b + (to.b - from.b) * t
    };
  }
  if (kind === 'colors' && Array.isArray(from) && Array.isArray(to)) {
    if (from.length !== to.length) return to;
    return to.map((color, i) => interpolateValue(from[i], color, t, 'color'));
  }
  if (typeof from === 'number' && typeof to === 'number') {
    return from + (to - from) * t;
  }
  return to;
}

// This type is a lighting pattern that is shown on the light display. The `tick` function
// has to be called at regular intervals to update the lighting pattern. The data for the
// pattern itself is returned through the `data` function
export abstract class Pattern {
  name: string;
  enabled: boolean;
  opacity: number;
  blendMode: number;
  state: Array<ColorAlpha>;

  // The ease an edit started, or null while the parameters sit at their committed
  // values.
  private parameterFade: ParameterFade | null = null;

  constructor({ name, enabled, opacity, blendMode }: PatternBaseProps) {
    this.name = name;
    this.enabled = enabled ?? true;
    this.opacity = opacity ?? SHARED_FIELDS.opacity.default;
    this.blendMode = blendMode ?? SHARED_FIELDS.blendMode.default;
    this.state = Array.from({ length: config.nLights }, () => ({
      r: 0,
      g: 0,
      b: 0,
      a: 0
    }));
  }

  /**
   * Returns the parameters of the concrete subclass as an object.
   */
  abstract parameters(): object;

  /**
   * Sets all of the parameters of the concrete subclass. If a parameter is not present
   * in the provided object, the subclass keeps the current value.
   */
  abstract set(values: object): void;

  /**
   * Applies a partial update of every parameter: the shared ones the base class owns
   * and, through `set`, the subclass's own. With a positive `duration` the change eases
   * in from what is currently lit over that many seconds (driven by `advance`) instead
   * of landing at once.
   */
  update(values: object, duration = 0): void {
    const from = this.parameterValues();
    this.applyValues(values);
    const to = this.parameterValues();

    if (duration > 0 && this.enabled && parametersDiffer(from, to)) {
      this.parameterFade = { from, to, elapsed: 0, duration };
    } else {
      this.parameterFade = null;
    }
  }

  // Advance a parameter ease started by `update` by one frame, a no-op while none is
  // running. At the end the committed values are applied exactly, so the ease can't
  // stall a frame short of them.
  advance(dt: number): void {
    const fade = this.parameterFade;
    if (fade === null) return;

    fade.elapsed += dt;
    const t = fade.elapsed / fade.duration;
    if (t >= 1) {
      this.parameterFade = null;
      this.applyValues(fade.to);
    } else {
      this.applyValues(interpolateParameters(fade.from, fade.to, t, this.fields()));
    }
  }

  // The parameters as the lights currently show them. While an ease is running the
  // fields hold the eased values, so a new edit re-targets from what is lit rather
  // than from where the ease started.
  private parameterValues(): Record<string, unknown> {
    return {
      ...(this.parameters() as Record<string, unknown>),
      opacity: this.opacity,
      blendMode: this.blendMode
    };
  }

  // Apply parameter values the way `update` does: the shared ones directly and the
  // subclass's own through `set`. `propsFromParameters` flattens the nested `color`
  // back into `r`/`g`/`b` (and is the identity for already-flat values), the shape
  // `set` expects.
  private applyValues(values: object): void {
    const { opacity, blendMode } = values as Partial<PatternBaseProps>;
    if (opacity !== undefined) this.opacity = opacity;
    if (blendMode !== undefined) this.blendMode = blendMode;
    this.set(Pattern.propsFromParameters(values));
  }

  // The schema describing this pattern's parameters: its own `Fields` plus the shared
  // ones, read off the concrete class so the base class needs no registry import.
  private fields(): PatternSchema {
    const own = (this.constructor as unknown as { Fields?: PatternSchema }).Fields;
    return { ...own, ...SHARED_FIELDS };
  }

  /**
   * The full serialized form of the pattern: the subclass's own parameters plus the
   * shared state the base class owns. While an edit is still easing in, the committed
   * target is reported rather than the values in flight, so a save or a re-read never
   * captures a mid-ease snapshot.
   */
  serialize(): object {
    if (this.parameterFade !== null) {
      return { ...this.parameterFade.to, enabled: this.enabled };
    }
    return {
      ...this.parameters(),
      enabled: this.enabled,
      opacity: this.opacity,
      blendMode: this.blendMode
    };
  }

  /**
   * Inverse of `parameters()`: flatten a serialized parameter object back into the flat
   * props a pattern constructor expects. `parameters()` nests color as `{ color: { r, g,
   * b } }`, so undo that nesting and drop the `type` tag.
   */
  static propsFromParameters(params: object): object {
    const { type, color, ...rest } = params as {
      type?: string;
      color?: Color;
    } & Record<string, unknown>;
    void type;
    return { ...rest, ...color };
  }

  /**
   * Advance the animation by one frame. Subclasses implement their motion here.
   *
   * @param dt The frame time, so how much time has passed (in seconds) since the previous
   *           update
   */
  abstract tick(dt: number): void;

  // Flat per-light values as [r, g, b, a, ...]; alpha lets the server blend layers.
  data(): Array<number> {
    const res: Array<number> = [];
    for (const c of this.state) {
      res.push(c.r);
      res.push(c.g);
      res.push(c.b);
      res.push(c.a * this.opacity);
    }
    return res;
  }

  protected rotate(steps: number) {
    if (steps == 0) return;

    const reverse = steps < 0;
    if (steps < 0) {
      steps = Math.abs(steps);
    }
    for (let i = 0; i < steps; i++) {
      if (reverse) {
        this.state.unshift(this.state.pop()!);
      } else {
        this.state.push(this.state.shift()!);
      }
    }
  }
}
