import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { Engine } from '../server/engine';
import { loadScenes, migrate } from '../server/storage';
import { validateNewPatternProps } from '../server/validation';
import { PATTERN_TYPES, type Scene } from '../shared/patterns/patterns';

import { build, frameProblem, type Params, propsOf } from './helpers';

// Every pattern type with all defaults, then each parameter on its own at up to three
// values, written by the released 1.1.0 code as exported scene files, one per type.
const V1_1_TYPES = [
  'StaticPattern',
  'MovingGaussian',
  'Sparkle',
  'Rainbow',
  'SineWave',
  'Comet',
  'Bounce',
  'Pulse',
  'Gradient',
  'ColorCycle',
  'Fire',
  'TheaterChase',
  'Aurora',
  'Ripple',
  'Plasma',
  'Interference',
  'Candle',
  'ColorTemperature',
  'Wipe',
  'Meteors',
  'Fireworks',
  'Rain',
  'Lightning',
  'Audio',
  'Video'
];

// The pattern data version 1.1.0 stamps on scenes.json and exported scenes.
const V1_1_DATA_VERSION = 2;

// Serve the scenes file from memory and keep writes off the disk.
const disk = vi.hoisted(() => ({ scenes: '' }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: vi.fn(() => Promise.resolve(disk.scenes)),
  writeFile: vi.fn(() => Promise.resolve()),
  mkdir: vi.fn(() => Promise.resolve())
}));

const dir = resolve(import.meta.dirname, 'fixtures', 'v1.1.0', 'parameters');
const read = (type: string) =>
  JSON.parse(readFileSync(resolve(dir, `${type}.json`), 'utf8')) as {
    version: number;
    name: string;
    patterns: Params[];
  };

// The scenes.json 1.1.0 would have written holding just this scene.
const scenesFile = ({ name, patterns }: { name: string; patterns: Params[] }) => ({
  version: V1_1_DATA_VERSION,
  scenes: [{ name, patterns }]
});

const DTS = [0, 1 / 30, 1 / 30, 1, 1 / 30];

// What a 1.1.0 pattern has to look like once converted, so it renders as it did. Add a
// case here when a later version converts 1.1.0 data.
function expectedAfterMigration(old: Params): Record<string, unknown> {
  return { ...old };
}

describe('1.1.0 parameter values', () => {
  it('has a file for every 1.1.0 pattern type', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.map((f) => f.replace(/\.json$/, '')).sort()).toEqual(
      [...V1_1_TYPES].sort()
    );
    for (const type of V1_1_TYPES) expect(PATTERN_TYPES).toContain(type);
  });

  it.each(V1_1_TYPES)(
    '%s: every parameter value migrates, validates and renders',
    (type) => {
      const scene = read(type);
      expect(scene.name).toBe(type);
      expect(scene.version).toBe(V1_1_DATA_VERSION);
      const [migrated] = migrate(scenesFile(scene));
      expect(migrated.patterns).toHaveLength(scene.patterns.length);

      const failures: string[] = [];
      scene.patterns.forEach((old, i) => {
        const params = migrated.patterns[i] as unknown as Params;
        try {
          expect(params).toMatchObject(expectedAfterMigration(old));
          const rest: Record<string, unknown> = { ...params };
          delete rest.enabled;
          validateNewPatternProps(type, propsOf(rest));
          const instance = build(params);
          expect(instance.enabled).toBe(old.enabled);
          expect(instance.serialize()).toMatchObject(params);
          const initial = frameProblem(instance);
          if (initial) throw new Error(`before the first tick: ${initial}`);
          for (const dt of DTS) {
            instance.advance(dt);
            instance.tick(dt);
            const problem = frameProblem(instance);
            if (problem) throw new Error(`dt=${dt}: ${problem}`);
          }
        } catch (err) {
          failures.push(`${old.name}: ${(err as Error).message}`);
        }
      });
      expect(failures).toEqual([]);
    }
  );

  it.each(V1_1_TYPES)('%s: imports as an exported scene', async (type) => {
    const scene = read(type);
    const [migrated] = migrate(scenesFile(scene));
    const imported = await new Engine().importScene(scene);
    expect(imported).toHaveLength(1);
    expect(imported[0].name).toBe(type);
    expect(imported[0].patterns).toMatchObject(migrated.patterns);
  });

  it.each(V1_1_TYPES)('%s: loads from a scenes file and applies', async (type) => {
    const scene = read(type);
    disk.scenes = JSON.stringify(scenesFile(scene));
    const loaded: Scene[] = await loadScenes();
    expect(loaded).toEqual(migrate(scenesFile(scene)));

    const engine = new Engine();
    await engine.load();
    engine.replaceWithScene(type);
    expect(engine.listPatterns()).toMatchObject(loaded[0].patterns);
    for (const dt of DTS) engine.tick(dt);
  });
});
