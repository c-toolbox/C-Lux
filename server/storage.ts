import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Scene } from '../shared/patterns/patterns';

import { config } from './config';

// Scenes are named pattern combinations that can be applied on demand, and the only
// pattern state that survives a restart. Resolved relative to the project root,
// regardless of cwd.
const scenesPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  config.server.scenes
);

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
