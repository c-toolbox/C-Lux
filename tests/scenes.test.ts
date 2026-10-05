import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../server/config';
import { Engine } from '../server/engine';
import { HttpError } from '../server/errors';
import { loadScenes, migrate, saveScenes, SCENES_FILE_VERSION } from '../server/storage';
import { validateName, validateNewPatternProps } from '../server/validation';
import { migratePatterns, PATTERN_DATA_VERSION } from '../shared/migrate';
import {
  PATTERN_TYPES,
  patternByType,
  type Scene,
  SCENE_EXPORT_VERSION
} from '../shared/patterns/patterns';
import { SOLID_COLOR_NAME } from '../shared/patterns/static';

import { animate, build, defaultParameters, type Params, propsOf } from './helpers';

// Never let a test overwrite the real scenes.json.
vi.mock('../server/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/storage')>()),
  saveScenes: vi.fn(() => Promise.resolve())
}));

const scenesPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scenes.json');
const raw = JSON.parse(readFileSync(scenesPath, 'utf8')) as unknown;
const scenes = migrate(raw);

// The saved patterns that actually reach the pattern list; the solid color layer is
// filtered out on load.
const scenePatterns = scenes.flatMap((scene) =>
  scene.patterns
    .filter((p) => p.name !== SOLID_COLOR_NAME)
    .map((p) => [scene.name, p.name, p as unknown as Params] as const)
);

function frameProblem(frame: number[]): string | null {
  if (frame.length !== config.nLights * 3) return `frame has ${frame.length} values`;
  const bad = frame.findIndex((v) => !Number.isInteger(v) || v < 0 || v > 255);
  return bad === -1 ? null : `value ${bad} is ${frame[bad]}`;
}

function run(engine: Engine, frames: number): string | null {
  for (let i = 0; i < frames; i++) {
    engine.tick(1 / config.server.tickRate);
    const problem = frameProblem(engine.blend());
    if (problem) return `frame ${i}: ${problem}`;
  }
  return null;
}

describe('scenes.json', () => {
  it('is in the current format', () => {
    expect(raw).toMatchObject({ version: SCENES_FILE_VERSION });
    expect(Array.isArray((raw as { scenes: unknown }).scenes)).toBe(true);
  });

  it('loads through loadScenes', async () => {
    expect(await loadScenes()).toEqual(scenes);
  });

  it('has unique, valid scene names', () => {
    const names = scenes.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(validateName(name, 'scene name')).toBe(name);
  });

  it.each(scenes.map((s) => [s.name, s] as const))(
    'scene %s has unique, valid pattern names',
    (_name, scene) => {
      const names = scene.patterns.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) expect(validateName(name, 'pattern name')).toBe(name);
    }
  );
});

describe.each(scenePatterns)('scene %s, pattern %s', (_scene, _pattern, params) => {
  it('has a known type', () => {
    expect(patternByType(params.type)).toBeDefined();
  });

  it('passes the import validation', () => {
    const { enabled, ...rest } = params;
    expect(enabled === undefined || typeof enabled === 'boolean').toBe(true);
    expect(() => validateNewPatternProps(params.type, propsOf(rest))).not.toThrow();
  });

  it('builds and renders well-formed frames', () => {
    expect(animate(build(params))).toBeNull();
  });

  it('keeps every saved field when re-serialized', () => {
    const serialized = build(params).serialize() as Record<string, unknown>;
    expect(serialized.name).toBe(params.name);
    expect(serialized.type).toBe(params.type);
    expect(serialized.enabled).toBe(params.enabled ?? true);
  });
});

describe('scenes file migration', () => {
  const scene: Scene = { name: 'one', patterns: [] };

  it('accepts a bare array from before the version field', () => {
    expect(migrate([scene])).toEqual([scene]);
  });

  it('treats an unversioned object as version 1', () => {
    expect(migrate({ scenes: [scene] })).toEqual([scene]);
  });

  it('accepts the current version', () => {
    expect(migrate({ version: SCENES_FILE_VERSION, scenes: [scene] })).toEqual([scene]);
  });

  it('rejects a newer version', () => {
    expect(() => migrate({ version: SCENES_FILE_VERSION + 1, scenes: [] })).toThrow(
      /newer/
    );
  });

  it('rejects a non-numeric version', () => {
    expect(() => migrate({ version: '1', scenes: [] })).toThrow(/must be a number/);
  });

  it.each([null, 42, 'scenes', {}, { scenes: {} }])('rejects %o', (value) => {
    expect(() => migrate(value)).toThrow(/recognized format/);
  });

  const sparkle = { name: 's', type: 'Sparkle', hue: 300, hueRange: 120 };

  it('converts version 1 patterns', () => {
    const [migrated] = migrate({
      version: 1,
      scenes: [{ name: 'one', patterns: [sparkle] }]
    });
    expect(migrated.patterns[0]).toMatchObject({ hue: 0, hueRange: 120 });
  });

  it('converts patterns in a bare array', () => {
    const [migrated] = migrate([{ name: 'one', patterns: [sparkle] }]);
    expect(migrated.patterns[0]).toMatchObject({ hue: 0 });
  });

  it('leaves current patterns alone', () => {
    const file = {
      version: SCENES_FILE_VERSION,
      scenes: [{ name: 'one', patterns: [sparkle] }]
    };
    expect(migrate(file)[0].patterns[0]).toEqual(sparkle);
  });
});

describe('pattern migration', () => {
  it('is at the version both scene files carry', () => {
    expect(SCENES_FILE_VERSION).toBe(PATTERN_DATA_VERSION);
    expect(SCENE_EXPORT_VERSION).toBe(PATTERN_DATA_VERSION);
  });

  it.each([
    [0, 0, 0],
    [200, 0, 200],
    [0, 360, 180],
    [100, 140, 170],
    [300, 120, 0]
  ])(
    'centers a version 1 Sparkle hue %d with range %d on %d',
    (hue, hueRange, centered) => {
      const [p] = migratePatterns([{ type: 'Sparkle', hue, hueRange }], 1);
      expect(p).toEqual({ type: 'Sparkle', hue: centered, hueRange, attack: 0 });
    }
  );

  it('defaults the fields added in version 2', () => {
    const [audio, sparkle] = migratePatterns(
      [defaultParameters('Audio', 'a'), defaultParameters('Sparkle', 's')].map(
        ({ hz: _hz, color: _color, attack: _attack, ...rest }) => rest
      ),
      1
    ) as Params[];
    expect(() => validateNewPatternProps('Audio', propsOf(audio))).not.toThrow();
    expect(() => validateNewPatternProps('Sparkle', propsOf(sparkle))).not.toThrow();
  });

  it('leaves other pattern types alone', () => {
    const plasma = { type: 'Plasma', hue: 100, hueRange: 140 };
    expect(migratePatterns([plasma], 1)).toEqual([plasma]);
  });

  it('passes malformed entries through for validation', () => {
    const entries = [null, 42, [], { type: 'Sparkle', hue: 'red', hueRange: 10 }];
    expect(migratePatterns(entries, 1)).toEqual(entries);
  });
});

describe('engine with the saved scenes', () => {
  let engine: Engine;

  beforeEach(async () => {
    vi.mocked(saveScenes).mockClear();
    engine = new Engine();
    await engine.load();
  });

  it('loads every scene without the solid color layer', () => {
    expect(engine.listScenes().map((s) => s.name)).toEqual(scenes.map((s) => s.name));
    for (const scene of engine.listScenes()) {
      expect(scene.patterns.some((p) => p.name === SOLID_COLOR_NAME)).toBe(false);
    }
  });

  it.each(scenes.map((s) => s.name))('replaces the stack with scene %s', (name) => {
    expect(engine.replaceWithScene(name)).toEqual([name]);
    expect(engine.listPatterns().map((p) => p.name)).toEqual(
      scenes
        .find((s) => s.name === name)!
        .patterns.filter((p) => p.name !== SOLID_COLOR_NAME)
        .map((p) => p.name)
    );
    expect(run(engine, 120)).toBeNull();
  });

  it('applies every scene at once, then switches them all off', () => {
    for (const scene of scenes) engine.applyScene(scene.name);
    expect(engine.appliedScenes()).toEqual(scenes.map((s) => s.name));
    expect(run(engine, 120)).toBeNull();

    for (const scene of scenes) engine.unapplyScene(scene.name);
    expect(engine.appliedScenes()).toEqual([]);
    expect(engine.listPatterns()).toEqual([]);
    expect(run(engine, 120)).toBeNull();
  });

  it.each(scenes.map((s) => [s.name, s] as const))(
    're-imports scene %s as exported',
    async (name, scene) => {
      await engine.importScene({ version: SCENE_EXPORT_VERSION, ...scene });
      const imported = engine.listScenes().at(-1)!;
      expect(imported.name).toBe(`${name} 2`);
      expect(imported.patterns.map((p) => p.name)).toEqual(
        scene.patterns.filter((p) => p.name !== SOLID_COLOR_NAME).map((p) => p.name)
      );
      expect(saveScenes).toHaveBeenCalledOnce();
    }
  );

  it('blends every pattern type together', () => {
    for (const type of PATTERN_TYPES) {
      const { name, ...props } = defaultParameters(type, `all-${type}`);
      engine.addPattern(type, { ...propsOf(props), name });
    }
    expect(run(engine, 120)).toBeNull();
  });

  it('converts an import from an older version', async () => {
    const pattern = { ...defaultParameters('Sparkle', 'old'), hue: 100, hueRange: 140 };
    for (const version of [undefined, 1]) {
      await engine.importScene({ version, name: 'old', patterns: [pattern] });
      expect(engine.listScenes().at(-1)!.patterns[0]).toMatchObject({ hue: 170 });
    }
  });

  it('rejects an import with an unknown pattern type', async () => {
    await expect(
      engine.importScene({ name: 'bad', patterns: [{ name: 'x', type: 'Nope' }] })
    ).rejects.toBeInstanceOf(HttpError);
    expect(saveScenes).not.toHaveBeenCalled();
  });
});
