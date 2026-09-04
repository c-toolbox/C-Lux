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
}

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

// This type is a lighting pattern that is shown on the light display. The `tick` function
// has to be called at regular intervals to update the lighting pattern. The data for the
// pattern itself is returned through the `data` function
export abstract class Pattern {
  name: string;
  enabled: boolean;
  opacity: number;
  state: Array<ColorAlpha>;

  constructor({ name, enabled, opacity }: PatternBaseProps) {
    this.name = name;
    this.enabled = enabled ?? true;
    this.opacity = opacity ?? SHARED_FIELDS.opacity.default;
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
   * and, through `set`, the subclass's own.
   */
  update(values: object): void {
    const { opacity } = values as Partial<PatternBaseProps>;
    if (opacity !== undefined) this.opacity = opacity;
    this.set(values);
  }

  /**
   * The full serialized form of the pattern: the subclass's own parameters plus the
   * shared state the base class owns.
   */
  serialize(): object {
    return { ...this.parameters(), enabled: this.enabled, opacity: this.opacity };
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
