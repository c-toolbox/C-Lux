import type { NumberRange } from './patterns/pattern';
import { patternByType } from './patterns/patterns';
import { HttpError } from './errors';

// Keeps stored names reasonable and out of any control-character weirdness; pattern and
// library set names are persisted to disk and used as map keys.
const NAME_MAX_LENGTH = 60;
const NAME_PATTERN = /^[\p{L}\p{N} _.'-]+$/u;

// Validate a user-supplied name (pattern name, library set name, …), trimming and
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

// Require an actual boolean, so a malformed value like the string "false" is rejected
// instead of being coerced into the opposite of what the client meant.
export function validateBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new HttpError(400, `${label} must be true or false`);
  }
  return value;
}

// Fields with a well-defined 0-255 range (RGB channels), validated more strictly than
// the generic finite-number check below.
const BYTE_FIELDS = new Set(['r', 'g', 'b']);

// Recursively verify every leaf value of a pattern's props is a finite number (color
// sub-objects like `color2` are checked the same way), so malformed client input -
// missing fields, strings, NaN - fails fast with a clear 400 instead of silently
// corrupting pattern state with NaN.
export function validatePatternProps(
  props: unknown,
  path = 'props'
): Record<string, unknown> {
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    throw new HttpError(400, `${path} must be an object`);
  }

  for (const [key, value] of Object.entries(props)) {
    if (key === 'name') continue; // validated separately via validateName

    const fieldPath = `${path}.${key}`;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new HttpError(400, `${fieldPath} must be a finite number`);
      }
      if (BYTE_FIELDS.has(key) && (value < 0 || value > 255)) {
        throw new HttpError(400, `${fieldPath} must be between 0 and 255`);
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      validatePatternProps(value, fieldPath);
    } else {
      throw new HttpError(400, `${fieldPath} must be a number`);
    }
  }

  return props as Record<string, unknown>;
}

// Constraint for a single pattern prop: an optional numeric range, or `'color'` for a
// nested `{ r, g, b }` object.
const BYTE: NumberRange = { min: 0, max: 255 };

const COLOR_CHANNELS = ['r', 'g', 'b'] as const;

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
  const validated = validatePatternProps(props);

  const fields = patternByType(type)?.Fields;
  if (!fields) throw new HttpError(400, `Unknown pattern type: ${type}`);

  const missing = (value: unknown) => !requireAll && value === undefined;

  for (const [key, spec] of Object.entries(fields)) {
    // The primary color reaches the constructor flattened into r/g/b; any further color
    // (`color2`) stays a nested object, matching `Pattern.propsFromParameters`.
    if (spec.kind === 'color' && key === 'color') {
      for (const channel of COLOR_CHANNELS) {
        if (missing(validated[channel])) continue;
        requireNumberInRange(validated[channel], BYTE, `props.${channel}`);
      }
      continue;
    }

    const value = validated[key];
    if (missing(value)) continue;

    if (spec.kind === 'color') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new HttpError(400, `props.${key} must be an object with r, g and b`);
      }
      const color = value as Record<string, unknown>;
      for (const channel of COLOR_CHANNELS) {
        requireNumberInRange(color[channel], BYTE, `props.${key}.${channel}`);
      }
    } else if (spec.kind === 'select') {
      if (!spec.options.some((option) => option.value === value)) {
        const allowed = spec.options.map((option) => option.value).join(', ');
        throw new HttpError(400, `props.${key} must be one of ${allowed}`);
      }
    } else {
      requireNumberInRange(value, spec, `props.${key}`);
    }
  }

  return validated;
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
