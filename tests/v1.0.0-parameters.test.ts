import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { Engine } from '../server/engine';
import { loadScenes, migrate } from '../server/storage';
import { validateNewPatternProps } from '../server/validation';
import { hsvToRgb } from '../shared/patterns/pattern';
import { PATTERN_TYPES, type Scene } from '../shared/patterns/patterns';

import { build, frameProblem, type Params, propsOf } from './helpers';

// Every pattern type with all defaults, then each parameter on its own at up to three
// values, written by the released 1.0.0 code as exported scene files, one per type.
const V1_TYPES = [
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

// Serve the scenes file from memory and keep writes off the disk.
const disk = vi.hoisted(() => ({ scenes: '' }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: vi.fn(() => Promise.resolve(disk.scenes)),
  writeFile: vi.fn(() => Promise.resolve()),
  mkdir: vi.fn(() => Promise.resolve())
}));

const dir = resolve(import.meta.dirname, 'fixtures', 'v1.0.0', 'parameters');
const read = (type: string) =>
  JSON.parse(readFileSync(resolve(dir, `${type}.json`), 'utf8')) as {
    name: string;
    patterns: Params[];
  };

const DTS = [0, 1 / 30, 1 / 30, 1, 1 / 30];

// What a 1.0.0 pattern has to look like once converted, so it renders as it did.
function expectedAfterMigration(old: Params): Record<string, unknown> {
  const p: Record<string, unknown> = { ...old };
  switch (old.type) {
    case 'MovingGaussian':
      p.speed = 0 - (old.speed as number);
      break;
    case 'Gradient':
      p.colors = [old.color, old.color2];
      delete p.color;
      delete p.color2;
      break;
    case 'Sparkle':
    case 'Plasma': {
      const hue = old.hue as number;
      const hueRange = old.hueRange as number;
      p.color = hsvToRgb((hue + hueRange / 2) % 360, old.saturation as number, 1);
      delete p.hue;
      delete p.saturation;
      break;
    }
    case 'Lightning':
      p.attack = 0;
      break;
    default:
      break;
  }
  return p;
}

describe('1.0.0 parameter values', () => {
  it('has a file for every 1.0.0 pattern type', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.map((f) => f.replace(/\.json$/, '')).sort()).toEqual(
      [...V1_TYPES].sort()
    );
    for (const type of V1_TYPES) expect(PATTERN_TYPES).toContain(type);
  });

  it.each(V1_TYPES)(
    '%s: every parameter value migrates, validates and renders',
    (type) => {
      const scene = read(type);
      expect(scene.name).toBe(type);
      const [migrated] = migrate({ version: 1, scenes: [scene] });
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

  it.each(V1_TYPES)('%s: imports as an exported scene', async (type) => {
    const scene = read(type);
    const [migrated] = migrate({ version: 1, scenes: [scene] });
    const imported = await new Engine().importScene(scene);
    expect(imported).toHaveLength(1);
    expect(imported[0].name).toBe(type);
    expect(imported[0].patterns).toMatchObject(migrated.patterns);
  });

  it.each(V1_TYPES)('%s: loads from a scenes file and applies', async (type) => {
    const scene = read(type);
    disk.scenes = JSON.stringify({ version: 1, scenes: [scene] });
    const loaded: Scene[] = await loadScenes();
    expect(loaded).toEqual(migrate({ version: 1, scenes: [scene] }));

    const engine = new Engine();
    await engine.load();
    engine.replaceWithScene(type);
    expect(engine.listPatterns()).toMatchObject(loaded[0].patterns);
    for (const dt of DTS) engine.tick(dt);
  });
});
