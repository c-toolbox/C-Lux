import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '../config.json' with { type: 'json' };

import { Pattern } from './patterns/pattern';
import {
  patternFromParameters,
  type PatternParameters,
  type StoredPatternSet
} from './patterns/patterns';

// Resolve the storage file relative to the project root, regardless of cwd.
const storagePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  config.server.storage
);

// The library keeps named pattern presets that can be added back on demand.
const libraryPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  config.server.library
);

// Load the stored patterns from disk, reconstructing each concrete instance.
export async function loadPatterns(): Promise<Array<Pattern>> {
  let raw: string;
  try {
    raw = await readFile(storagePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const stored = JSON.parse(raw) as Array<PatternParameters>;
  const patterns: Array<Pattern> = [];
  for (const params of stored) {
    const instance = patternFromParameters(params);
    if (!instance) {
      console.warn(`Skipping unknown stored pattern type: ${params.type}`);
      continue;
    }
    patterns.push(instance);
  }
  return patterns;
}

// Persist the current patterns to disk as JSON.
export async function savePatterns(patterns: Array<Pattern>): Promise<void> {
  const data = patterns.map((p) => p.parameters());
  await mkdir(dirname(storagePath), { recursive: true });
  await writeFile(storagePath, JSON.stringify(data, null, 2), 'utf8');
}

// Load the stored pattern library (named pattern sets) from disk.
export async function loadLibrary(): Promise<Array<StoredPatternSet>> {
  try {
    const raw = await readFile(libraryPath, 'utf8');
    return JSON.parse(raw) as Array<StoredPatternSet>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

// Persist the pattern library to disk as JSON.
export async function saveLibrary(entries: Array<StoredPatternSet>): Promise<void> {
  await mkdir(dirname(libraryPath), { recursive: true });
  await writeFile(libraryPath, JSON.stringify(entries, null, 2), 'utf8');
}
