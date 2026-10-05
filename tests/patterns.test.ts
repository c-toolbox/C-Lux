import { describe, expect, it, vi } from 'vitest';

import { validateNewPatternProps } from '../server/validation';
import { AUDIO_BANDS, setAudioFrame } from '../shared/audio';
import { AUDIO_TYPE } from '../shared/patterns/audio';
import { BlendMode, type Color, isFieldVisible } from '../shared/patterns/pattern';
import {
  type FieldSpec,
  PATTERN_TYPES,
  patternByType,
  patternFields
} from '../shared/patterns/patterns';

import {
  animate,
  build,
  defaultParameters,
  edgeValues,
  mulberry32,
  type Params,
  propsOf,
  randomValue
} from './helpers';

const FUZZ_CASES = 25;

// Every combination of a pattern's select options; these switch between whole render
// paths, so each pairing is worth a run of its own.
function selectCombinations(type: string): Array<Record<string, number>> {
  const selects = Object.entries(patternFields(type)!).filter(
    (entry): entry is [string, Extract<FieldSpec, { kind: 'select' }>] =>
      entry[1].kind === 'select'
  );
  return selects.reduce<Array<Record<string, number>>>(
    (combos, [key, spec]) =>
      combos.flatMap((combo) => spec.options.map((o) => ({ ...combo, [key]: o.value }))),
    [{}]
  );
}

// Build a pattern from parameters the server would accept, after checking that it does.
function buildValidated(params: Params) {
  validateNewPatternProps(params.type, propsOf(params));
  return build(params);
}

describe.each(PATTERN_TYPES)('%s pattern', (type) => {
  const fields = patternFields(type)!;

  it('builds from its defaults', () => {
    const pattern = build(defaultParameters(type));
    expect(pattern).toBeInstanceOf(patternByType(type)!);
    expect(pattern.name).toBe(`test-${type}`);
    expect(pattern.enabled).toBe(true);
  });

  it('renders well-formed frames with its defaults', () => {
    expect(animate(build(defaultParameters(type)))).toBeNull();
  });

  it('serializes every field with the type tag', () => {
    const serialized = build(defaultParameters(type)).serialize() as Record<
      string,
      unknown
    >;
    expect(serialized.type).toBe(type);
    expect(serialized.enabled).toBe(true);
    for (const key of Object.keys(fields)) expect(serialized).toHaveProperty(key);
  });

  it('round-trips through serialize and patternFromParameters', () => {
    const original = build(defaultParameters(type)).serialize();
    expect(build(original as Params).serialize()).toEqual(original);
  });

  it('round-trips a disabled, half-opaque, subtracting pattern', () => {
    const params = {
      ...defaultParameters(type),
      enabled: false,
      opacity: 0.5,
      blendMode: BlendMode.Subtract
    };
    const pattern = build(params);
    expect(pattern.enabled).toBe(false);
    expect(pattern.opacity).toBe(0.5);
    expect(pattern.blendMode).toBe(BlendMode.Subtract);
    expect(build(pattern.serialize() as Params).serialize()).toEqual(pattern.serialize());
  });

  it('defaults to alpha blending', () => {
    const params: Record<string, unknown> = defaultParameters(type);
    delete params.blendMode;
    expect(build(params as Params).blendMode).toBe(BlendMode.Alpha);
  });

  // Audio only paints its color in single-frequency mode; it has its own tests.
  const colorKeys = Object.entries(fields)
    .filter(([, spec]) => spec.kind === 'color' || spec.kind === 'colors')
    .map(([key]) => key);
  it.runIf(colorKeys.length > 0 && type !== AUDIO_TYPE)(
    'stays dark with fully transparent colors',
    () => {
      vi.spyOn(Math, 'random').mockImplementation(mulberry32(7));
      const params = defaultParameters(type);
      for (const key of colorKeys) {
        const value = params[key] as Color | Color[];
        params[key] = Array.isArray(value)
          ? value.map((c) => ({ ...c, a: 0 }))
          : { ...value, a: 0 };
      }
      const pattern = build(params);
      for (let i = 0; i < 60; i++) {
        pattern.advance(1 / 30);
        pattern.tick(1 / 30);
        const lit = pattern.state.findIndex((l) => Math.max(l.r, l.g, l.b) * l.a > 0);
        expect(lit, `frame ${i}`).toBe(-1);
      }
      vi.restoreAllMocks();
    }
  );

  it('scales alpha by opacity', () => {
    const pattern = build({ ...defaultParameters(type), opacity: 0 });
    pattern.tick(1 / 30);
    const data = pattern.data();
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(0);
  });

  it.each(Object.entries(fields))('renders every edge value of %s', (key, spec) => {
    for (const value of edgeValues(spec)) {
      const params = { ...defaultParameters(type), [key]: value };
      const problem = animate(buildValidated(params));
      expect(problem, `${key}=${JSON.stringify(value)}`).toBeNull();
    }
  });

  it.each(selectCombinations(type))('renders select combination %o', (combo) => {
    expect(animate(buildValidated({ ...defaultParameters(type), ...combo }))).toBeNull();
  });

  it(`renders ${FUZZ_CASES} random valid configurations`, () => {
    const random = mulberry32(PATTERN_TYPES.indexOf(type) + 1);
    for (let n = 0; n < FUZZ_CASES; n++) {
      const params = defaultParameters(type);
      for (const [key, spec] of Object.entries(fields))
        params[key] = randomValue(spec, random);
      expect(animate(buildValidated(params)), JSON.stringify(params)).toBeNull();
    }
  });

  it.each(Object.entries(fields))(
    'eases an update of %s to its committed value',
    (key, spec) => {
      const values = edgeValues(spec);
      const target = { ...defaultParameters(type), [key]: values[values.length - 1] };
      const expected = build(target).serialize();

      const pattern = build(defaultParameters(type));
      const update: Record<string, unknown> = { ...target };
      delete update.name;
      delete update.type;
      pattern.update(update, 1);
      // A save mid-ease captures the committed target, not the in-flight values.
      expect(pattern.serialize()).toEqual(expected);

      for (let i = 0; i < 40; i++) {
        pattern.advance(1 / 30);
        pattern.tick(1 / 30);
      }
      expect(pattern.serialize()).toEqual(expected);
      expect(animate(pattern)).toBeNull();
    }
  );

  it('applies an instant update', () => {
    const pattern = build(defaultParameters(type));
    pattern.update({ opacity: 0.25 });
    expect(pattern.opacity).toBe(0.25);
  });

  // The editor hides a field when it can't matter, so it must really have no effect.
  it('ignores every field while the editor hides it', () => {
    const frames = (params: Params) => {
      // Re-published per run, so the feed can't go stale partway through the test.
      if (type === AUDIO_TYPE) {
        setAudioFrame(
          params.name,
          Array.from({ length: AUDIO_BANDS }, (_, k) => (k % 3) / 2),
          0.7
        );
      }
      vi.spyOn(Math, 'random').mockImplementation(mulberry32(3));
      const pattern = build(params);
      const out: number[][] = [];
      for (let i = 0; i < 10; i++) {
        pattern.tick(1 / 30);
        out.push(pattern.data());
      }
      vi.restoreAllMocks();
      return out;
    };

    for (const combo of selectCombinations(type)) {
      const base = { ...defaultParameters(type), ...combo };
      for (const [key, spec] of Object.entries(fields)) {
        if (isFieldVisible(spec, base)) continue;
        const expected = frames(base);
        for (const value of edgeValues(spec)) {
          expect(
            frames({ ...base, [key]: value }),
            `${key}=${JSON.stringify(value)} with ${JSON.stringify(combo)}`
          ).toEqual(expected);
        }
      }
    }
  });
});
