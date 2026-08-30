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

// Bumped whenever the on-disk shape changes, so `migrate` below can bring an older file
// up to date instead of the server having to reject it.
export const SCENES_FILE_VERSION = 1;

// The on-disk shape of the scenes file.
interface ScenesFile {
  version: number;
  scenes: Array<Scene>;
}

// Bring a file written by an older version up to the current one. Files predating the
// version field are a bare array of scenes.
function migrate(parsed: unknown): Array<Scene> {
  if (Array.isArray(parsed)) return parsed as Array<Scene>;

  const file = parsed as Partial<ScenesFile>;
  if (typeof file.version !== 'number' || !Array.isArray(file.scenes)) {
    throw new Error('scenes file is not in a recognized format');
  }
  if (file.version > SCENES_FILE_VERSION) {
    throw new Error(
      `scenes file version ${file.version} is newer than the supported version ${SCENES_FILE_VERSION}`
    );
  }
  return file.scenes;
}

// Load the saved scenes from disk, upgrading an older file format on the way.
export async function loadScenes(): Promise<Array<Scene>> {
  try {
    const raw = await readFile(scenesPath, 'utf8');
    return migrate(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

// Persist the scenes to disk as JSON, stamped with the current file version.
export async function saveScenes(scenes: Array<Scene>): Promise<void> {
  const file: ScenesFile = { version: SCENES_FILE_VERSION, scenes };
  await mkdir(dirname(scenesPath), { recursive: true });
  await writeFile(scenesPath, JSON.stringify(file, null, 2), 'utf8');
}
