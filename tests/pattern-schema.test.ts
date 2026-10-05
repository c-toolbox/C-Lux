import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { HttpError } from '../server/errors';
import {
  validateNewPatternProps,
  validateUpdatedPatternProps
} from '../server/validation';
import { MAX_COLORS, SHARED_FIELDS } from '../shared/patterns/pattern';
import {
  PATTERN_TYPES,
  patternByType,
  patternDisplayName,
  patternFields
} from '../shared/patterns/patterns';

import { defaultParameters, edgeValues, propsOf } from './helpers';

const patternsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'shared',
  'patterns'
);

// Keys the base class or the serialized form already own; a field named like one of
// them would be silently overwritten.
const RESERVED_KEYS = ['name', 'type', 'enabled', 'r', 'g', 'b'];

function expectRejected(type: string, props: Record<string, unknown>, match: RegExp) {
  let error: unknown;
  try {
    validateNewPatternProps(type, props);
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(400);
  expect((error as HttpError).message).toMatch(match);
}

describe('pattern registry', () => {
  it('registers one pattern per module in shared/patterns', () => {
    const modules = readdirSync(patternsDir).filter(
      (file) => file.endsWith('.ts') && file !== 'pattern.ts' && file !== 'patterns.ts'
    );
    expect(PATTERN_TYPES).toHaveLength(modules.length);
  });

  it('uses unique types and display names', () => {
    expect(new Set(PATTERN_TYPES).size).toBe(PATTERN_TYPES.length);
    const names = PATTERN_TYPES.map(patternDisplayName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('returns nothing for an unknown type', () => {
    expect(patternByType('NoSuchPattern')).toBeUndefined();
    expect(patternFields('NoSuchPattern')).toBeUndefined();
    expect(patternDisplayName('NoSuchPattern')).toBe('NoSuchPattern');
  });

  it('rejects an unknown type in validation', () => {
    expectRejected('NoSuchPattern', {}, /Unknown pattern type/);
  });
});

describe.each(PATTERN_TYPES)('%s schema', (type) => {
  const cls = patternByType(type)!;
  const fields = patternFields(type)!;
  const own = Object.entries(cls.Fields);

  it('has a display name and at least one own field', () => {
    expect(cls.Type).toBe(type);
    expect(cls.DisplayName.trim()).not.toBe('');
    expect(own.length).toBeGreaterThan(0);
  });

  it('includes every shared field', () => {
    for (const key of Object.keys(SHARED_FIELDS)) expect(fields).toHaveProperty(key);
  });

  it.each(own)('field %s does not clash with reserved keys', (key) => {
    expect(RESERVED_KEYS).not.toContain(key);
    expect(Object.keys(SHARED_FIELDS)).not.toContain(key);
  });

  it.each(Object.entries(fields))('field %s is well-formed', (_key, spec) => {
    expect(spec.label.trim()).not.toBe('');
    if (spec.row !== undefined) expect(Number.isInteger(spec.row)).toBe(true);

    switch (spec.kind) {
      case 'select': {
        expect(spec.options.length).toBeGreaterThan(1);
        const values = spec.options.map((o) => o.value);
        expect(new Set(values).size).toBe(values.length);
        expect(values).toContain(spec.default);
        for (const option of spec.options) expect(option.label.trim()).not.toBe('');
        break;
      }
      case 'color':
        for (const v of Object.values(spec.default)) {
          expect(Number.isInteger(v) && v >= 0 && v <= 255).toBe(true);
        }
        break;
      case 'colors':
        expect(spec.default.length).toBeGreaterThan(0);
        expect(spec.default.length).toBeLessThanOrEqual(MAX_COLORS);
        break;
      case 'colorMap':
        expect(spec.default.length).toBeGreaterThan(0);
        expect(spec.default.length).toBeLessThanOrEqual(MAX_COLORS);
        for (const stop of spec.default) {
          expect(stop.t >= 0 && stop.t <= 1).toBe(true);
        }
        break;
      default:
        expect(Number.isFinite(spec.default)).toBe(true);
        if (spec.step !== undefined) expect(spec.step).toBeGreaterThan(0);
        if (spec.min !== undefined) expect(spec.default).toBeGreaterThanOrEqual(spec.min);
        if (spec.max !== undefined) expect(spec.default).toBeLessThanOrEqual(spec.max);
        if (spec.exclusiveMin !== undefined) {
          expect(spec.default).toBeGreaterThan(spec.exclusiveMin);
        }
        if (spec.min !== undefined && spec.max !== undefined) {
          expect(spec.min).toBeLessThan(spec.max);
        }
    }
  });
});

describe.each(PATTERN_TYPES)('%s validation', (type) => {
  const fields = patternFields(type)!;
  const own = Object.entries(patternByType(type)!.Fields);
  const defaults = propsOf(defaultParameters(type));

  it('accepts the defaults', () => {
    expect(() => validateNewPatternProps(type, defaults)).not.toThrow();
  });

  it('accepts an empty partial update', () => {
    expect(() => validateUpdatedPatternProps(type, {})).not.toThrow();
  });

  it('accepts patterns saved before the shared fields existed', () => {
    const props = { ...defaults };
    for (const key of Object.keys(SHARED_FIELDS)) delete props[key];
    expect(() => validateNewPatternProps(type, props)).not.toThrow();
  });

  it.each(Object.entries(fields))('accepts every edge value of %s', (key, spec) => {
    for (const value of edgeValues(spec)) {
      const props = propsOf({ ...defaultParameters(type), [key]: value });
      expect(() => validateNewPatternProps(type, props)).not.toThrow();
      expect(() =>
        validateUpdatedPatternProps(type, propsOf({ [key]: value }))
      ).not.toThrow();
    }
  });

  it.each(own)('requires %s when creating', (key, spec) => {
    const props = { ...defaults };
    if (spec.kind === 'color' && key === 'color') delete props.g;
    else delete props[key];
    expectRejected(type, props, /Missing|must be/);
  });

  it.each(Object.entries(fields))('rejects out-of-range values of %s', (key, spec) => {
    const reject = (value: unknown) =>
      expectRejected(type, propsOf({ ...defaultParameters(type), [key]: value }), /./);

    switch (spec.kind) {
      case 'select':
        reject(Math.max(...spec.options.map((o) => o.value)) + 1);
        reject(0.5);
        break;
      case 'color':
        reject({ r: 256, g: 0, b: 0 });
        reject({ r: 0, g: -1, b: 0 });
        reject({ r: 0, g: 0, b: Number.NaN });
        reject({ r: 0, g: 0, b: 0, a: 1.5 });
        reject({ r: 0, g: 0, b: 0, a: -0.1 });
        reject({ r: 0, g: 0, b: 0, a: 'opaque' });
        break;
      case 'colors':
        reject([]);
        reject(Array.from({ length: MAX_COLORS + 1 }, () => ({ r: 0, g: 0, b: 0 })));
        reject([{ r: 0, g: 0, b: 300 }]);
        reject([{ r: 0, g: 0 }]);
        reject([{ r: 0, g: 0, b: 0, a: 2 }]);
        break;
      case 'colorMap':
        reject([]);
        reject(
          Array.from({ length: MAX_COLORS + 1 }, () => ({ t: 0, r: 0, g: 0, b: 0 }))
        );
        reject([{ r: 0, g: 0, b: 0 }]);
        reject([{ t: -0.1, r: 0, g: 0, b: 0 }]);
        reject([{ t: 1.1, r: 0, g: 0, b: 0 }]);
        reject([{ t: 0, r: 0, g: 0, b: 300 }]);
        reject([{ t: 0, r: 0, g: 0 }]);
        reject([{ t: 0, r: 0, g: 0, b: 0, a: 2 }]);
        reject([0.5]);
        break;
      default:
        if (spec.min !== undefined) reject(spec.min - 1);
        if (spec.max !== undefined) reject(spec.max + 1);
        if (spec.exclusiveMin !== undefined) reject(spec.exclusiveMin);
    }
  });

  it.each(Object.keys(fields))('rejects a non-numeric %s', (key) => {
    const props = propsOf({ ...defaultParameters(type), [key]: 'oops' });
    expectRejected(type, props, /must be/);
    expectRejected(
      type,
      propsOf({ ...defaultParameters(type), [key]: null }),
      /Missing|must be/
    );
    expectRejected(
      type,
      propsOf({ ...defaultParameters(type), [key]: Number.POSITIVE_INFINITY }),
      /./
    );
  });

  it('rejects props that are not an object', () => {
    expectRejected(type, null as unknown as Record<string, unknown>, /must be an object/);
  });
});
