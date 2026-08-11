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
