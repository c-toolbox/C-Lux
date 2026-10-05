import config from '../config.json' with { type: 'json' };
import { type Color, MAX_COLORS, Pattern } from '../shared/patterns/pattern';
import {
  type FieldSpec,
  patternFields,
  patternFromParameters,
  type PatternParameters
} from '../shared/patterns/patterns';

export const N_LIGHTS = config.nLights;

// Rounding noise tolerated on the 0-255 and 0-1 output ranges.
const EPSILON = 1e-6;

export type Params = Record<string, unknown> & { name: string; type: string };

// Serialized parameters for a pattern type with every field at its default.
export function defaultParameters(type: string, name = `test-${type}`): Params {
  const fields = patternFields(type);
  if (!fields) throw new Error(`Unknown pattern type: ${type}`);

  const params: Params = { name, type };
  for (const [key, spec] of Object.entries(fields)) {
    params[key] = structuredClone(spec.default);
  }
  return params;
}

// The props a parameter object turns into on the way into a constructor or the
// validator, the same flattening `Engine.importScene` applies.
export function propsOf(params: Record<string, unknown>): Record<string, unknown> {
  return Pattern.propsFromParameters(params) as Record<string, unknown>;
}

export function build(params: Params): Pattern {
  const instance = patternFromParameters(params as unknown as PatternParameters);
  if (!instance) throw new Error(`Could not build pattern of type ${params.type}`);
  return instance;
}

// Build a pattern with its defaults, overriding some parameters (in serialized shape).
export function make(type: string, overrides: Record<string, unknown> = {}): Pattern {
  return build({ ...defaultParameters(type), ...overrides });
}

// Tick a pattern through `seconds` at a steady frame time.
export function run(pattern: Pattern, seconds: number, dt = 1 / 30): void {
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) {
    pattern.advance(dt);
    pattern.tick(dt);
  }
}

export const alphas = (pattern: Pattern): number[] => pattern.state.map((l) => l.a);

export function rgbAt(pattern: Pattern, i: number): Color {
  const { r, g, b } = pattern.state[i];
  return { r, g, b };
}

// Indices of the lights whose alpha is above `threshold`.
export const litLights = (pattern: Pattern, threshold = 0): number[] =>
  pattern.state.flatMap((light, i) => (light.a > threshold ? [i] : []));

export const argmax = (values: number[]): number =>
  values.reduce((best, v, i) => (v > values[best] ? i : best), 0);

export const mod = (value: number, n: number): number => ((value % n) + n) % n;

// Indices that are strict local maxima of a circular signal.
export function localMaxima(values: number[]): number[] {
  const n = values.length;
  return values.flatMap((v, i) =>
    v > values[mod(i - 1, n)] && v >= values[mod(i + 1, n)] ? [i] : []
  );
}

// Number of separate circular runs of lights for which `on` holds.
export function countRuns(on: boolean[]): number {
  const n = on.length;
  return on.filter((v, i) => v && !on[mod(i - 1, n)]).length || (on[0] ? 1 : 0);
}

const palette = (length: number): Color[] =>
  Array.from({ length }, (_, i) => ({
    r: (i * 53) % 256,
    g: (i * 97) % 256,
    b: 255 - ((i * 31) % 256)
  }));

// Values worth exercising for a field: its default plus every edge the validator lets
// through. Unbounded ends get a value well past the default.
export function edgeValues(spec: FieldSpec): unknown[] {
  switch (spec.kind) {
    case 'select':
      return spec.options.map((option) => option.value);
    case 'color':
      return [
        spec.default,
        { r: 0, g: 0, b: 0 },
        { r: 255, g: 255, b: 255 },
        { r: 0, g: 0, b: 0, a: 0 },
        { r: 255, g: 0, b: 128, a: 0.5 }
      ];
    case 'colors':
      return [
        spec.default,
        palette(1),
        palette(2).map((c) => ({ ...c, a: 0 })),
        palette(MAX_COLORS).map((c, i) => ({ ...c, a: i % 2 ? 0.5 : 1 }))
      ];
    default: {
      const far = Math.max(10, Math.abs(spec.default) * 10);
      const values = [spec.default];
      if (spec.min !== undefined) values.push(spec.min);
      if (spec.exclusiveMin !== undefined) values.push(spec.exclusiveMin + 1e-3);
      if (spec.min === undefined && spec.exclusiveMin === undefined) values.push(-far);
      values.push(spec.max ?? far);
      return values;
    }
  }
}

// Deterministic PRNG so a failing fuzz case reproduces.
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A random value the validator accepts for a field.
export function randomValue(spec: FieldSpec, random: () => number): unknown {
  const byte = () => Math.floor(random() * 256);
  switch (spec.kind) {
    case 'select':
      return spec.options[Math.floor(random() * spec.options.length)].value;
    case 'color':
      return { r: byte(), g: byte(), b: byte() };
    case 'colors':
      return Array.from({ length: 1 + Math.floor(random() * MAX_COLORS) }, () => ({
        r: byte(),
        g: byte(),
        b: byte()
      }));
    default: {
      const span = Math.max(10, Math.abs(spec.default) * 10);
      const low =
        spec.min ?? (spec.exclusiveMin !== undefined ? spec.exclusiveMin : -span);
      const high = spec.max ?? low + 2 * span;
      const value = low + random() * (high - low);
      return spec.exclusiveMin !== undefined && value <= spec.exclusiveMin
        ? spec.exclusiveMin + 1e-3
        : value;
    }
  }
}

// Describe the first light whose output is out of range, or null when the whole frame
// is well-formed: finite RGB in [0, 255] and alpha in [0, 1].
export function frameProblem(pattern: Pattern): string | null {
  const data = pattern.data();
  if (data.length !== N_LIGHTS * 4) {
    return `data() has ${data.length} values, expected ${N_LIGHTS * 4}`;
  }
  for (let i = 0; i < data.length; i += 4) {
    const light = i / 4;
    for (let c = 0; c < 3; c++) {
      const v = data[i + c];
      if (!Number.isFinite(v) || v < -EPSILON || v > 255 + EPSILON) {
        return `light ${light} channel ${'rgb'[c]} is ${v}`;
      }
    }
    const alpha = data[i + 3];
    if (!Number.isFinite(alpha) || alpha < -EPSILON || alpha > 1 + EPSILON) {
      return `light ${light} alpha is ${alpha}`;
    }
  }
  return null;
}

// Frame times covering a steady tick rate, a stalled tick, and a long hitch.
const DTS = [
  ...Array.from({ length: 90 }, () => 1 / 30),
  0,
  ...Array.from({ length: 30 }, () => 1 / 120),
  1,
  5,
  ...Array.from({ length: 30 }, () => 1 / 30)
];

// Run a pattern through a few seconds of frames, returning the first malformed one.
export function animate(pattern: Pattern): string | null {
  const initial = frameProblem(pattern);
  if (initial) return `before the first tick: ${initial}`;

  for (const [frame, dt] of DTS.entries()) {
    pattern.advance(dt);
    pattern.tick(dt);
    const problem = frameProblem(pattern);
    if (problem) return `frame ${frame} (dt=${dt}): ${problem}`;
  }
  return null;
}
