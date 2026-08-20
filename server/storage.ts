import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '../config.json' with { type: 'json' };

import { Pattern } from './patterns/pattern';
import {
  patternFromParameters,
  type PatternParameters,
  type Scene
} from './patterns/patterns';

// Resolve the storage file relative to the project root, regardless of cwd.
const storagePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  config.server.storage
);

// Scenes are named pattern combinations that can be applied on demand.
const scenesPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  config.server.scenes
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

// Load the saved scenes from disk.
export async function loadScenes(): Promise<Array<Scene>> {
  try {
    const raw = await readFile(scenesPath, 'utf8');
    return JSON.parse(raw) as Array<Scene>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

// Persist the scenes to disk as JSON.
export async function saveScenes(scenes: Array<Scene>): Promise<void> {
  await mkdir(dirname(scenesPath), { recursive: true });
  await writeFile(scenesPath, JSON.stringify(scenes, null, 2), 'utf8');
}
