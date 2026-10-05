import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migratePatterns, PATTERN_DATA_VERSION } from '../shared/migrate';
import { type Scene } from '../shared/patterns/patterns';
import { validateTimeline } from '../shared/timeline';

// Scenes are named pattern combinations that can be applied on demand, and the only
// pattern state that survives a restart. Resolved relative to the project root,
// regardless of cwd.
const scenesPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scenes.json');

// Bumped whenever the on-disk shape changes, so `migrate` below can bring an older file
// up to date instead of the server having to reject it.
export const SCENES_FILE_VERSION = PATTERN_DATA_VERSION;

// The on-disk shape of the scenes file.
interface ScenesFile {
  version: number;
  scenes: Array<Scene>;
}

// Bring a file written by an older version up to the current one. Files predating the
// version field are a bare array of scenes, or an object with no version, both treated
// as version 1.
export function migrate(parsed: unknown): Array<Scene> {
  if (Array.isArray(parsed)) return migrateScenes(parsed as Array<Scene>, 1);

  const file = parsed as Partial<ScenesFile> | null;
  if (typeof file !== 'object' || file === null || !Array.isArray(file.scenes)) {
    throw new Error('scenes file is not in a recognized format');
  }
  const version = file.version ?? 1;
  if (typeof version !== 'number') {
    throw new Error('scenes file version must be a number');
  }
  if (version > SCENES_FILE_VERSION) {
    throw new Error(
      `scenes file version ${version} is newer than the supported version ${SCENES_FILE_VERSION}`
    );
  }
  return migrateScenes(file.scenes, version);
}

function migrateScenes(scenes: Array<Scene>, version: number): Array<Scene> {
  return scenes.map(({ timeline, ...scene }) => {
    const migrated: Scene = {
      ...scene,
      patterns: migratePatterns(scene.patterns, version) as Scene['patterns']
    };
    if (timeline === undefined) return migrated;
    // A broken timeline shouldn't cost the scene its patterns, so only it is dropped.
    try {
      return { ...migrated, timeline: validateTimeline(timeline) };
    } catch (err) {
      console.warn(
        `Dropping the timeline of scene ${scene.name}:`,
        (err as Error).message
      );
      return migrated;
    }
  });
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
