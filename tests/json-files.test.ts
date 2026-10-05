import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  config,
  configSchema,
  configUpdateSchema,
  currentSettings
} from '../server/config';
import { validateName } from '../server/validation';
import { RESTART_REQUIRED_SETTINGS } from '../shared/config';
import { REMAP_DISABLED } from '../shared/remap';
import names from '../src/assets/names.json' with { type: 'json' };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(join(root, file), 'utf8'));

// tsconfig files are JSONC, and build output and dependencies aren't ours to check.
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-server']);

function projectJsonFiles(dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return SKIPPED_DIRS.has(entry.name) ? [] : projectJsonFiles(path);
    if (!entry.name.endsWith('.json') || entry.name.startsWith('tsconfig')) return [];
    return [relative(root, path)];
  });
}

// The structure of a JSON value with every leaf replaced by its type, so two files can
// be compared shape for shape regardless of the values they hold.
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, shapeOf(v)])
    );
  }
  return typeof value;
}

describe('project JSON files', () => {
  const files = projectJsonFiles();

  it('finds the known JSON files', () => {
    const normalized = files.map((f) => f.replaceAll('\\', '/'));
    for (const file of [
      'config.json',
      'config.sample.json',
      'package.json',
      'src/assets/names.json'
    ]) {
      expect(normalized).toContain(file);
    }
  });

  it.each(files)('%s parses as JSON', (file) => {
    expect(() => readJson(file)).not.toThrow();
  });
});

describe.each(['config.json', 'config.sample.json'])('%s', (file) => {
  const raw = readJson(file);

  it('passes the config schema', () => {
    const result = configSchema.safeParse(raw);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('carries the current file version', () => {
    expect((raw as { version: unknown }).version).toBe(1);
  });

  it('spells out every setting rather than leaning on defaults', () => {
    const parsed = configSchema.parse(raw);
    expect(shapeOf(raw)).toEqual(shapeOf(parsed));
  });

  it('has an Art-Net channel range that fits a universe', () => {
    const { artnet } = configSchema.parse(raw).output;
    expect(artnet.startChannel).toBeLessThanOrEqual(artnet.universeSize);
    if (artnet.endChannel !== 0) {
      expect(artnet.endChannel).toBeGreaterThanOrEqual(artnet.startChannel);
    }
  });
});

describe('config.sample.json', () => {
  const sample = readJson('config.sample.json') as { server: { editPassword: string } };

  it('has the same shape as config.json', () => {
    expect(shapeOf(sample)).toEqual(shapeOf(readJson('config.json')));
  });

  it('ships without an edit password', () => {
    expect(sample.server.editPassword).toBe('');
  });
});

describe('loaded config', () => {
  it('matches config.json on disk', () => {
    expect(config).toEqual(configSchema.parse(readJson('config.json')));
  });

  it('round-trips through the config page update schema', () => {
    const result = configUpdateSchema.safeParse({ settings: currentSettings() });
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('never exposes the edit password through currentSettings', () => {
    expect(JSON.stringify(currentSettings())).not.toContain('editPassword');
  });

  it.each(RESTART_REQUIRED_SETTINGS)('resolves restart-required path %s', (path) => {
    const value = path
      .split('.')
      .reduce<unknown>(
        (node, key) => (node as Record<string, unknown> | undefined)?.[key],
        currentSettings()
      );
    expect(value).toBeDefined();
  });
});

describe('config schema', () => {
  const valid = () =>
    structuredClone(readJson('config.sample.json')) as {
      version?: number;
      nLights: number;
      server: Record<string, unknown> & { remap: Record<string, number> };
      output: { artnet: Record<string, unknown> };
    };

  const issues = (raw: unknown) =>
    configSchema.safeParse(raw).error?.issues.map((i) => i.path.join('.')) ?? [];

  it('treats a missing version as version 1', () => {
    const raw = valid();
    delete raw.version;
    expect(configSchema.parse(raw).version).toBe(1);
  });

  it('rejects a newer version', () => {
    expect(issues({ ...valid(), version: 2 })).toContain('version');
  });

  it('defaults the remap and edit password', () => {
    const raw = valid();
    delete (raw.server as Partial<typeof raw.server>).remap;
    delete raw.server.editPassword;
    const parsed = configSchema.parse(raw);
    expect(parsed.server.remap).toEqual({});
    expect(parsed.server.editPassword).toBe('');
  });

  it('accepts one-way remaps and several disabled lights', () => {
    const raw = valid();
    raw.server.remap = { '0': 1, '5': 3, '6': REMAP_DISABLED, '7': REMAP_DISABLED };
    expect(issues(raw)).toEqual([]);
  });

  it('rejects two remaps onto the same light', () => {
    const raw = valid();
    raw.server.remap = { '5': 3, '6': 3 };
    expect(issues(raw)).toEqual(['server.remap.6']);
  });

  it('rejects remaps outside the ring', () => {
    const raw = valid();
    raw.server.remap = { [raw.nLights]: 0, '0': raw.nLights };
    expect(issues(raw)).toHaveLength(2);
  });

  it('rejects a non-numeric remap key', () => {
    const raw = valid();
    raw.server.remap = { five: 3 };
    expect(issues(raw).length).toBeGreaterThan(0);
  });

  it.each([
    ['nLights', (c: ReturnType<typeof valid>) => void (c.nLights = 0)],
    ['server.tickRate', (c: ReturnType<typeof valid>) => void (c.server.tickRate = 0)],
    ['server.port', (c: ReturnType<typeof valid>) => void (c.server.port = 70000)],
    [
      'server.halfLightCoverage',
      (c: ReturnType<typeof valid>) => void (c.server.halfLightCoverage = 1.5)
    ],
    [
      'server.sceneTransition',
      (c: ReturnType<typeof valid>) => void (c.server.sceneTransition = -1)
    ],
    [
      'output.artnet.universeSize',
      (c: ReturnType<typeof valid>) => void (c.output.artnet.universeSize = 513)
    ],
    [
      'output.artnet.host',
      (c: ReturnType<typeof valid>) => void (c.output.artnet.host = '')
    ],
    [
      'output.artnet.startChannel',
      (c: ReturnType<typeof valid>) => void (c.output.artnet.startChannel = 0)
    ]
  ])('rejects an invalid %s', (path, mutate) => {
    const raw = valid();
    mutate(raw);
    expect(issues(raw)).toContain(path);
  });

  it('rejects a missing section', () => {
    const raw: Partial<ReturnType<typeof valid>> = valid();
    delete raw.output;
    expect(issues(raw)).toContain('output');
  });
});

describe('src/assets/names.json', () => {
  const lists = { adjectives: names.adjectives, nouns: names.nouns };

  it('carries the current file version', () => {
    expect(names.version).toBe(1);
  });

  it.each(Object.entries(lists))('has a non-empty list of unique %s', (_key, list) => {
    expect(list.length).toBeGreaterThan(10);
    expect(new Set(list).size).toBe(list.length);
  });

  it.each(Object.entries(lists))(
    'has only lowercase single words in %s',
    (_key, list) => {
      for (const word of list) expect(word).toMatch(/^[a-z]+$/);
    }
  );

  it('produces random names the server accepts', () => {
    const longest = (list: string[]) =>
      list.reduce((a, b) => (b.length > a.length ? b : a), '');
    // The longest possible pairing, plus every word in some pairing.
    const samples = [
      `${longest(names.adjectives)}-${longest(names.nouns)}`,
      ...names.adjectives.map((a, i) => `${a}-${names.nouns[i % names.nouns.length]}`),
      ...names.nouns.map(
        (n, i) => `${names.adjectives[i % names.adjectives.length]}-${n}`
      )
    ];
    for (const name of samples) expect(validateName(name, 'pattern name')).toBe(name);
  });
});
