import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { configSchema } from '../server/config';
import { Engine } from '../server/engine';
import { migrate } from '../server/storage';
import { validateNewPatternProps } from '../server/validation';
import { hsvToRgb } from '../shared/patterns/pattern';
import { PATTERN_TYPES, type Scene } from '../shared/patterns/patterns';

import { animate, build, type Params, propsOf } from './helpers';

// Files written by the released 1.0.0 code, which every later version must load.
vi.mock('../server/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/storage')>()),
  loadScenes: vi.fn(() => Promise.resolve([])),
  saveScenes: vi.fn(() => Promise.resolve())
}));

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'v1.0.0');
const readFixture = (file: string): unknown =>
  JSON.parse(readFileSync(resolve(fixtures, file), 'utf8'));

const scenes = migrate(readFixture('scenes.json'));
const patterns = scenes.flatMap((scene) =>
  scene.patterns.map((p) => [scene.name, p.name, p as unknown as Params] as const)
);
const byName = (scene: string, name: string): Params =>
  patterns.find(([s, n]) => s === scene && n === name)![2];

describe('1.0.0 scenes.json', () => {
  it('holds every pattern type of 1.0.0', () => {
    expect(scenes.map((s) => s.name)).toEqual(['all-defaults', 'customized']);
    for (const scene of scenes) expect(scene.patterns).toHaveLength(25);
  });

  it.each(patterns)('scene %s, pattern %s loads and renders', (_s, _p, params) => {
    expect(PATTERN_TYPES).toContain(params.type);
    const rest: Record<string, unknown> = { ...params };
    delete rest.enabled;
    expect(() => validateNewPatternProps(params.type, propsOf(rest))).not.toThrow();
    expect(animate(build(params))).toBeNull();
  });

  it('keeps the shared settings', () => {
    expect(byName('customized', 'c-Rain')).toMatchObject({
      enabled: false,
      opacity: 0.6
    });
    expect(byName('customized', 'c-Fire')).toMatchObject({ enabled: true, opacity: 0.6 });
  });

  it('converts the changed parameters', () => {
    expect(byName('customized', 'c-Gradient').colors).toEqual([
      { r: 10, g: 200, b: 30 },
      { r: 200, g: 0, b: 100 }
    ]);
    expect(byName('customized', 'c-MovingGaussian').speed).toBe(-0.2);
    expect(byName('customized', 'c-Lightning').attack).toBe(0);
    expect(byName('customized', 'c-Sparkle')).toMatchObject({
      color: hsvToRgb(230, 0.7, 1),
      hueRange: 60
    });
    expect(byName('customized', 'c-Plasma')).toMatchObject({
      color: hsvToRgb(85, 0.6, 1),
      hueRange: 90
    });
  });
});

describe('1.0.0 exported scene', () => {
  it('imports with every pattern', async () => {
    const engine = new Engine();
    const raw = readFixture('exported-scene.json') as Scene;
    const imported = await engine.importScene(raw);
    const scene = imported.find((s) => s.name === raw.name)!;
    expect(scene.patterns.map((p) => p.name)).toEqual(raw.patterns.map((p) => p.name));
    expect(scene.patterns.find((p) => p.name === 'c-MovingGaussian')).toMatchObject({
      speed: -0.2
    });
  });
});

describe('1.0.0 config.json', () => {
  it('passes the config schema as version 1', () => {
    const result = configSchema.safeParse(readFixture('config.json'));
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.data?.version).toBe(1);
  });
});
