import { z } from 'zod';

import {
  MAX_COLORS,
  type NumberRange,
  SHARED_FIELDS,
  UNIT
} from '../shared/patterns/pattern';
import { patternByType } from '../shared/patterns/patterns';
import { type Timeline, validateTimeline } from '../shared/timeline';

import { HttpError } from './errors';

// Parse a request body against a zod schema, mapping the first failure to a 400 with a
// readable message. Treats a missing body as an empty object.
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const [issue] = result.error.issues;
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw new HttpError(400, `${path}${issue.message}`);
  }
  return result.data;
}

// Keeps saved names reasonable and out of any control-character weirdness; pattern and
// scene names are persisted to disk and used as map keys.
const NAME_MAX_LENGTH = 60;
const NAME_PATTERN = /^[\p{L}\p{N} _.'-]+$/u;

// Validate a user-supplied name (pattern name, scene name, …), trimming and
// rejecting empty, oversized, or oddly-charactered values.
export function validateName(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be a string`);

  const trimmed = value.trim();
  if (trimmed === '') throw new HttpError(400, `Missing ${label}`);
  if (trimmed.length > NAME_MAX_LENGTH) {
    throw new HttpError(400, `${label} must be at most ${NAME_MAX_LENGTH} characters`);
  }
  if (!NAME_PATTERN.test(trimmed)) {
    throw new HttpError(
      400,
      `${label} may only contain letters, numbers, spaces, and - _ . '`
    );
  }
  return trimmed;
}

// `validateTimeline` with its complaint turned into a 400.
export function validateSceneTimeline(
  raw: unknown,
  patterns: ReadonlySet<string>
): Timeline {
  try {
    return validateTimeline(raw, patterns);
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
}

// Recursively verify every leaf value of a pattern's props is a finite number (color
// sub-objects like `color2` are checked the same way), so malformed client input -
// missing fields, strings, NaN - fails fast with a clear 400 instead of silently
// corrupting pattern state with NaN. Arrays are walked too, for palette props. Only the
// top-level keys in `textKeys` may hold a string; `validateAgainstSpec` checks those.
function validatePatternProps(
  props: unknown,
  path = 'props',
  textKeys: ReadonlySet<string> = new Set()
): Record<string, unknown> {
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    throw new HttpError(400, `${path} must be an object`);
  }

  for (const [key, value] of Object.entries(props)) {
    if (key === 'name') continue; // validated separately via validateName
    if (textKeys.has(key) && typeof value === 'string') continue;

    const fieldPath = `${path}.${key}`;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new HttpError(400, `${fieldPath} must be a finite number`);
      }
    } else if (Array.isArray(value)) {
      value.forEach((entry, i) => validatePatternProps(entry, `${fieldPath}[${i}]`));
    } else if (typeof value === 'object' && value !== null) {
      validatePatternProps(value, fieldPath);
    } else {
      throw new HttpError(400, `${fieldPath} must be a number`);
    }
  }

  return props as Record<string, unknown>;
}

// Constraint for a single pattern prop: an optional numeric range, or `'color'` for a
// nested `{ r, g, b, a? }` object.
const BYTE: NumberRange = { min: 0, max: 255 };

const COLOR_CHANNELS = ['r', 'g', 'b'] as const;

// Check a color's channels; the alpha is optional, older colors carry none.
function requireColor(color: Record<string, unknown>, path: string): void {
  for (const channel of COLOR_CHANNELS) {
    requireNumberInRange(color[channel], BYTE, `${path}.${channel}`);
  }
  if (color.a !== undefined) requireNumberInRange(color.a, UNIT, `${path}.a`);
}

// Validate the props of a pattern that is about to be constructed. Unlike
// `validatePatternProps`, which only checks the keys that are present (enough for a
// partial update), this requires every prop the pattern type needs, so an incomplete
// request can't produce an instance with undefined fields rendering NaN frames.
export function validateNewPatternProps(
  type: string,
  props: unknown
): Record<string, unknown> {
  return validateAgainstSpec(type, props, true);
}

// Validate a partial update: only the props the request actually carries are checked,
// but they must respect the same ranges as on creation.
export function validateUpdatedPatternProps(
  type: string,
  props: unknown
): Record<string, unknown> {
  return validateAgainstSpec(type, props, false);
}

// Check the props against the pattern class's own `Fields` schema, the same description
// the browser builds its form from, so ranges can never drift between the two.
function validateAgainstSpec(
  type: string,
  props: unknown,
  requireAll: boolean
): Record<string, unknown> {
  const fields = patternByType(type)?.Fields;
  if (!fields) {
    validatePatternProps(props);
    throw new HttpError(400, `Unknown pattern type: ${type}`);
  }

  const textKeys = new Set(
    Object.entries(fields)
      .filter(([, spec]) => spec.kind === 'text')
      .map(([key]) => key)
  );
  const validated = validatePatternProps(props, 'props', textKeys);

  const missing = (value: unknown) => !requireAll && value === undefined;

  for (const [key, spec] of Object.entries(fields)) {
    // The primary color reaches the constructor flattened into r/g/b/a; any further
    // color (`color2`) stays a nested object, matching `Pattern.propsFromParameters`.
    if (spec.kind === 'color' && key === 'color') {
      for (const channel of COLOR_CHANNELS) {
        if (missing(validated[channel])) continue;
        requireNumberInRange(validated[channel], BYTE, `props.${channel}`);
      }
      if (validated.a !== undefined) requireNumberInRange(validated.a, UNIT, 'props.a');
      continue;
    }

    const value = validated[key];
    if (missing(value)) continue;

    if (spec.kind === 'color') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new HttpError(400, `props.${key} must be an object with r, g and b`);
      }
      requireColor(value as Record<string, unknown>, `props.${key}`);
    } else if (spec.kind === 'colors') {
      if (!Array.isArray(value) || value.length === 0) {
        throw new HttpError(400, `props.${key} must be a non-empty array of colors`);
      }
      if (value.length > MAX_COLORS) {
        throw new HttpError(400, `props.${key} must hold at most ${MAX_COLORS} colors`);
      }
      value.forEach((entry, i) => {
        requireColor(entry as Record<string, unknown>, `props.${key}[${i}]`);
      });
    } else if (spec.kind === 'colorMap') {
      if (!Array.isArray(value) || value.length === 0) {
        throw new HttpError(400, `props.${key} must be a non-empty array of color stops`);
      }
      if (value.length > MAX_COLORS) {
        throw new HttpError(400, `props.${key} must hold at most ${MAX_COLORS} stops`);
      }
      value.forEach((entry, i) => {
        const stop = entry as Record<string, unknown>;
        requireNumberInRange(stop.t, UNIT, `props.${key}[${i}].t`);
        requireColor(stop, `props.${key}[${i}]`);
      });
    } else if (spec.kind === 'select') {
      requireOption(value, spec.options, `props.${key}`);
    } else if (spec.kind === 'text') {
      requireText(value, spec.maxLength, `props.${key}`);
    } else {
      requireNumberInRange(value, spec, `props.${key}`);
    }
  }

  // The shared fields stay optional even when creating: patterns saved before one of
  // them existed carry no value for it and fall back to its default.
  for (const [key, spec] of Object.entries(SHARED_FIELDS)) {
    if (validated[key] === undefined) continue;
    if (spec.kind === 'select') {
      requireOption(validated[key], spec.options, `props.${key}`);
    } else {
      requireNumberInRange(validated[key], spec, `props.${key}`);
    }
  }

  return validated;
}

// Free text ends up in saved scenes and in what the server is asked to look up, so it
// stays bounded and free of control characters.
function requireText(value: unknown, maxLength: number, path: string): void {
  if (typeof value !== 'string') throw new HttpError(400, `${path} must be a string`);
  if (value.length > maxLength) {
    throw new HttpError(400, `${path} must be at most ${maxLength} characters`);
  }
  if (/\p{Cc}/u.test(value)) {
    throw new HttpError(400, `${path} must not contain control characters`);
  }
}

function requireOption(
  value: unknown,
  options: ReadonlyArray<{ value: number }>,
  path: string
): void {
  if (!options.some((option) => option.value === value)) {
    throw new HttpError(
      400,
      `${path} must be one of ${options.map((o) => o.value).join(', ')}`
    );
  }
}

// Require a present, in-range number. Finiteness is already guaranteed by
// `validatePatternProps`, so a non-number here means the field is missing.
function requireNumberInRange(value: unknown, spec: NumberRange, path: string): void {
  if (typeof value !== 'number') throw new HttpError(400, `Missing ${path}`);
  if (spec.min !== undefined && value < spec.min) {
    throw new HttpError(400, `${path} must be at least ${spec.min}`);
  }
  if (spec.exclusiveMin !== undefined && value <= spec.exclusiveMin) {
    throw new HttpError(400, `${path} must be greater than ${spec.exclusiveMin}`);
  }
  if (spec.max !== undefined && value > spec.max) {
    throw new HttpError(400, `${path} must be at most ${spec.max}`);
  }
}
