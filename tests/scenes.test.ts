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
import { AUDIO_INPUT_SYSTEM } from '../shared/patterns/audio';
import { hsvToRgb } from '../shared/patterns/pattern';
import {
  PATTERN_TYPES,
  patternByType,
  type Scene,
  SCENE_EXPORT_VERSION
} from '../shared/patterns/patterns';
import { SOLID_COLOR_NAME } from '../shared/patterns/static';
import { videoCaptureOf, type VideoParameters } from '../shared/patterns/video';
import {
  DEFAULT_VIDEO_GEOMETRY,
  VIDEO_INPUT_NDI,
  VIDEO_INPUT_SCREEN,
  VIDEO_SAMPLING_FISHEYE
} from '../shared/video';

import {
  alphas,
  animate,
  argmax,
  build,
  defaultParameters,
  N_LIGHTS as N,
  type Params,
  propsOf
} from './helpers';

// Never let a test overwrite the real scenes.json.
vi.mock('../server/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/storage')>()),
  saveScenes: vi.fn(() => Promise.resolve())
}));

const scenesPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scenes.json');
const raw = JSON.parse(readFileSync(scenesPath, 'utf8')) as unknown;
const scenes = migrate(raw);

const RED = { r: 255, g: 0, b: 0 };

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

  const sparkle = { name: 's', type: 'Sparkle', hue: 300, hueRange: 120, saturation: 1 };

  it('converts version 1 patterns', () => {
    const [migrated] = migrate({
      version: 1,
      scenes: [{ name: 'one', patterns: [sparkle] }]
    });
    expect(migrated.patterns[0]).toMatchObject({ color: RED, hueRange: 120 });
  });

  it('converts patterns in a bare array', () => {
    const [migrated] = migrate([{ name: 'one', patterns: [sparkle] }]);
    expect(migrated.patterns[0]).toMatchObject({ color: RED });
  });

  it('leaves current patterns alone', () => {
    const file = {
      version: SCENES_FILE_VERSION,
      scenes: [{ name: 'one', patterns: [sparkle] }]
    };
    expect(migrate(file)[0].patterns[0]).toEqual(sparkle);
  });

  const timeline = {
    duration: 10,
    loop: true,
    tracks: { s: [{ start: 0, end: 5, fadeIn: 1, fadeOut: 0 }] }
  };

  it('keeps a scene timeline', () => {
    const file = {
      version: SCENES_FILE_VERSION,
      scenes: [{ name: 'one', patterns: [sparkle], timeline }]
    };
    expect(migrate(file)[0].timeline).toEqual(timeline);
  });

  it('drops a broken timeline but keeps the scene', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const file = {
      version: SCENES_FILE_VERSION,
      scenes: [{ name: 'one', patterns: [sparkle], timeline: { ...timeline, loop: 1 } }]
    };
    const [migrated] = migrate(file);
    expect(migrated).toEqual({ name: 'one', patterns: [sparkle] });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
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
      const [p] = migratePatterns([{ type: 'Sparkle', hue, hueRange, saturation: 1 }], 1);
      expect(p).toEqual({
        type: 'Sparkle',
        color: hsvToRgb(centered, 1, 1),
        hueRange,
        attack: 0
      });
    }
  );

  it.each([0, 0.4, 1])('keeps a version 1 Sparkle saturation %d', (saturation) => {
    const [p] = migratePatterns(
      [{ type: 'Sparkle', hue: 0, hueRange: 0, saturation }],
      1
    );
    expect(p).toMatchObject({ color: hsvToRgb(0, saturation, 1) });
  });

  it('keeps a version 1 Sparkle lighting the colors it used to', () => {
    const old = {
      ...defaultParameters('Sparkle', 's'),
      density: 1 / N,
      hue: 60,
      hueRange: 120,
      saturation: 0.8
    };
    delete (old as Record<string, unknown>).color;
    const [migrated] = migratePatterns([old], 1) as Params[];
    expect(() => validateNewPatternProps('Sparkle', propsOf(migrated))).not.toThrow();
    // Version 1 drew hues from the window starting at `hue`.
    for (const [random, hue] of [
      [0, 60],
      [0.25, 90],
      [0.75, 150]
    ]) {
      vi.spyOn(Math, 'random').mockReturnValue(random);
      const p = build(migrated);
      p.tick(1);
      const light = Math.floor(random * N);
      const lit = p.state[light];
      const expected = hsvToRgb(hue, 0.8, 1);
      expect(Math.abs(lit.r - expected.r), `hue ${hue}`).toBeLessThanOrEqual(1);
      expect(Math.abs(lit.g - expected.g), `hue ${hue}`).toBeLessThanOrEqual(1);
      expect(Math.abs(lit.b - expected.b), `hue ${hue}`).toBeLessThanOrEqual(1);
      vi.restoreAllMocks();
    }
  });

  it('defaults the fields added in version 2', () => {
    const [audio, sparkle] = migratePatterns(
      [
        defaultParameters('Audio', 'a'),
        { ...defaultParameters('Sparkle', 's'), hue: 0, saturation: 0 }
      ].map(
        ({
          input: _input,
          hz: _hz,
          color: _color,
          attack: _attack,
          colorMode: _colorMode,
          frontColor: _frontColor,
          backColor: _backColor,
          colorMap: _colorMap,
          ...rest
        }) => rest
      ),
      1
    ) as Params[];
    expect(() => validateNewPatternProps('Audio', propsOf(audio))).not.toThrow();
    expect(() => validateNewPatternProps('Sparkle', propsOf(sparkle))).not.toThrow();
  });

  // The capture panels used to hold these, starting on system audio, a shared screen and
  // the default fisheye rim.
  it('gives a version 1 Audio pattern the capture the panel started on', () => {
    const old: Record<string, unknown> = defaultParameters('Audio', 'a');
    delete old.input;
    const [migrated] = migratePatterns([old], 1) as Params[];
    expect(migrated.input).toBe(AUDIO_INPUT_SYSTEM);
  });

  it('gives a version 1 Video pattern the capture the panel started on', () => {
    const look = {
      offset: 0.25,
      direction: -1,
      fit: 1,
      smoothing: 0.5,
      saturation: 1,
      gamma: 2
    };
    const old = { name: 'v', type: 'Video', ...look };
    const [migrated] = migratePatterns([old], 1) as Params[];
    expect(migrated).toEqual({
      ...old,
      input: VIDEO_INPUT_SCREEN,
      ndiSource: '',
      sampling: VIDEO_SAMPLING_FISHEYE,
      ...DEFAULT_VIDEO_GEOMETRY
    });
    expect(() => validateNewPatternProps('Video', propsOf(migrated))).not.toThrow();
    expect(videoCaptureOf(build(migrated).serialize() as VideoParameters)).toEqual({
      input: VIDEO_INPUT_SCREEN,
      ndiSource: '',
      sampling: VIDEO_SAMPLING_FISHEYE,
      geometry: DEFAULT_VIDEO_GEOMETRY
    });
  });

  it('keeps the capture settings of a version 2 Video pattern', () => {
    const p = {
      ...defaultParameters('Video', 'v'),
      input: VIDEO_INPUT_NDI,
      ndiSource: 'STUDIO (Fisheye)',
      radius: 0.8
    };
    expect(migratePatterns([p], PATTERN_DATA_VERSION)).toEqual([p]);
  });

  it('keeps a version 1 Audio pattern sweeping its hue', () => {
    const old: Record<string, unknown> = {
      ...defaultParameters('Audio', 'a'),
      hue: 120,
      hueSpan: 0
    };
    for (const key of ['colorMode', 'frontColor', 'backColor', 'colorMap']) {
      delete old[key];
    }
    const [migrated] = migratePatterns([old], 1) as Params[];
    expect(migrated.colorMode).toBe(0);
    const p = build(migrated);
    for (const light of p.state) {
      expect({ r: light.r, g: light.g, b: light.b }).toEqual({ r: 0, g: 255, b: 0 });
    }
  });

  it.each([
    [0.07, -0.07],
    [-0.2, 0.2],
    [0, 0]
  ])('reverses a version 1 Moving Gaussian speed %d to %d', (speed, reversed) => {
    const [p] = migratePatterns([{ type: 'MovingGaussian', speed }], 1);
    expect(p).toEqual({ type: 'MovingGaussian', speed: reversed });
  });

  it('keeps a version 1 Moving Gaussian travelling the way it used to', () => {
    // Version 1 walked a positive speed toward lower light indices.
    const old = {
      ...defaultParameters('MovingGaussian', 'g'),
      speed: 5.5 / N,
      origin: 0
    };
    const [migrated] = migratePatterns([old], 1) as Params[];
    const p = build(migrated);
    p.tick(1);
    expect(argmax(alphas(p))).toBe(N - 5);
  });

  it('leaves a version 2 Moving Gaussian speed alone', () => {
    const p = { type: 'MovingGaussian', speed: 0.07 };
    expect(migratePatterns([p], PATTERN_DATA_VERSION)).toEqual([p]);
  });

  it('turns the two colors of a version 1 Gradient into its palette', () => {
    const color = { r: 1, g: 2, b: 3, a: 0.5 };
    const color2 = { r: 4, g: 5, b: 6 };
    const old = { name: 'g', type: 'Gradient', color, color2, speed: 0.1 };
    const [migrated] = migratePatterns([old], 1) as Params[];
    expect(migrated).toEqual({
      name: 'g',
      type: 'Gradient',
      colors: [color, color2],
      speed: 0.1
    });
    expect(() => validateNewPatternProps('Gradient', propsOf(migrated))).not.toThrow();
  });

  it('keeps a version 1 Gradient lighting the ring as it used to', () => {
    const color = { r: 77, g: 171, b: 247, a: 1 };
    const color2 = { r: 247, g: 77, b: 77, a: 0.25 };
    const [migrated] = migratePatterns(
      [{ name: 'g', type: 'Gradient', color, color2, speed: 0.1 }],
      1
    ) as Params[];
    const p = build(migrated);
    p.tick(1.7);
    for (let i = 0; i < N; i++) {
      // Version 1 blended the two colors with a cosine around the ring.
      const t = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i / N + 0.17));
      expect(p.state[i].r).toBeCloseTo(77 + 170 * t, 6);
      expect(p.state[i].g).toBeCloseTo(171 - 94 * t, 6);
      expect(p.state[i].b).toBeCloseTo(247 - 170 * t, 6);
      expect(p.state[i].a).toBeCloseTo(1 - 0.75 * t, 6);
    }
  });

  it('leaves a version 2 Gradient alone', () => {
    const p = defaultParameters('Gradient', 'g');
    expect(migratePatterns([p], PATTERN_DATA_VERSION)).toEqual([p]);
  });

  it('keeps version 1 Lightning flashes lighting instantly', () => {
    const old: Params = defaultParameters('Lightning', 'l');
    delete old.attack;
    const [migrated] = migratePatterns([old], 1) as Params[];
    expect(migrated).toEqual({ ...old, attack: 0 });
    expect(() => validateNewPatternProps('Lightning', propsOf(migrated))).not.toThrow();
  });

  it('leaves a version 2 Lightning attack alone', () => {
    const p = { ...defaultParameters('Lightning', 'l'), attack: 0.3 };
    expect(migratePatterns([p], PATTERN_DATA_VERSION)).toEqual([p]);
  });

  it('leaves other pattern types alone', () => {
    const rainbow = { type: 'Rainbow', hue: 100, hueRange: 140, saturation: 1 };
    expect(migratePatterns([rainbow], 1)).toEqual([rainbow]);
  });

  it('turns the hue window of a version 1 Plasma into a color', () => {
    const old = { type: 'Plasma', hue: 300, hueRange: 120, saturation: 0.5, scale: 2 };
    expect(migratePatterns([old], 1)).toEqual([
      { type: 'Plasma', hueRange: 120, scale: 2, color: hsvToRgb(0, 0.5, 1) }
    ]);
  });

  it('keeps a version 1 Plasma lighting the colors it used to', () => {
    const old: Params = {
      ...defaultParameters('Plasma', 'p'),
      hue: 200,
      hueRange: 140,
      saturation: 0.9,
      scale: 2,
      speed: 0
    };
    delete old.color;
    const [migrated] = migratePatterns([old], 1) as Params[];
    expect(() => validateNewPatternProps('Plasma', propsOf(migrated))).not.toThrow();
    const p = build(migrated);
    for (let i = 0; i < N; i++) {
      // Version 1 read the field as a hue from `hue` up to `hue + hueRange`.
      const x = i / N;
      const w =
        0.5 * Math.sin(2 * Math.PI * 2 * x) +
        0.3 * Math.sin(2 * Math.PI * 3 * x + 1.7) +
        0.2 * Math.sin(2 * Math.PI * 5 * x + 4.1);
      const expected = hsvToRgb(200 + 140 * (0.5 + 0.5 * w), 0.9, 1);
      const lit = p.state[i];
      expect(Math.abs(lit.r - expected.r), `light ${i}`).toBeLessThanOrEqual(1);
      expect(Math.abs(lit.g - expected.g), `light ${i}`).toBeLessThanOrEqual(1);
      expect(Math.abs(lit.b - expected.b), `light ${i}`).toBeLessThanOrEqual(1);
    }
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
    const pattern = {
      ...defaultParameters('Sparkle', 'old'),
      hue: 100,
      hueRange: 140,
      saturation: 1
    };
    delete (pattern as Record<string, unknown>).color;
    for (const version of [undefined, 1]) {
      await engine.importScene({ version, name: 'old', patterns: [pattern] });
      expect(engine.listScenes().at(-1)!.patterns[0]).toMatchObject({
        color: { ...hsvToRgb(170, 1, 1), a: 1 }
      });
    }
  });

  it('reverses the speed of an imported version 1 Moving Gaussian only', async () => {
    const pattern = { ...defaultParameters('MovingGaussian', 'g'), speed: 0.1 };
    await engine.importScene({ version: 1, name: 'old', patterns: [pattern] });
    expect(engine.listScenes().at(-1)!.patterns[0]).toMatchObject({ speed: -0.1 });
    await engine.importScene({ version: 2, name: 'new', patterns: [pattern] });
    expect(engine.listScenes().at(-1)!.patterns[0]).toMatchObject({ speed: 0.1 });
  });

  it('rejects an import with an unknown pattern type', async () => {
    await expect(
      engine.importScene({ name: 'bad', patterns: [{ name: 'x', type: 'Nope' }] })
    ).rejects.toBeInstanceOf(HttpError);
    expect(saveScenes).not.toHaveBeenCalled();
  });
});
