import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  type ConfigUpdate,
  RESTART_REQUIRED_SETTINGS,
  type Settings
} from '../shared/config';

// Read from disk at startup rather than imported, so that editing config.json on a
// deployed machine takes effect on the next restart. A JSON import would be inlined into
// the server bundle at build time and the file on disk would then be ignored entirely.
// Resolved relative to the project root, regardless of cwd.
const configPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config.json');

const serverSchema = z.object({
  tickRate: z.number().positive(),
  port: z.int().min(1).max(65535),
  scenes: z.string().min(1),
  // Guards the edit page and the endpoints it drives. Empty switches the protection
  // off altogether.
  editPassword: z.string().default(''),
  blackoutTransition: z.number().nonnegative(),
  halfLightTransition: z.number().nonnegative(),
  halfLightFeather: z.number().positive(),
  solidColorTransition: z.number().nonnegative(),
  sceneTransition: z.number().nonnegative()
});

const outputSchema = z.object({
  rotation: z.number(),
  // Fix-ups for lights that were patched to the wrong address: `"5": 3` sends the color
  // computed for light 5 to light 3 instead. Lights left out keep their 1:1 mapping;
  // entries may be one-way, but no two of them may land on the same light.
  remap: z
    .record(z.string().regex(/^\d+$/, 'must be a light index'), z.int().nonnegative())
    .default({}),
  artnet: z.object({
    enabled: z.boolean(),
    host: z.string().min(1),
    port: z.int().min(1).max(65535),
    net: z.int().nonnegative(),
    subnet: z.int().nonnegative(),
    universe: z.int().nonnegative(),
    startChannel: z.int().min(1),
    endChannel: z.int().nonnegative(),
    universeSize: z.int().min(2).max(512),
    refreshRate: z.number().positive()
  })
});

const baseConfigSchema = z.object({
  nLights: z.int().positive(),
  server: serverSchema,
  output: outputSchema
});

// Entries may be one-way; the only thing that cannot be resolved is two of them fighting
// over the same destination light.
function checkRemap(
  cfg: { nLights: number; output: { remap: Record<string, number> } },
  ctx: z.RefinementCtx
): void {
  const destinations = new Set<number>();

  for (const [from, to] of Object.entries(cfg.output.remap)) {
    if (Number(from) >= cfg.nLights || to >= cfg.nLights) {
      ctx.addIssue({
        code: 'custom',
        path: ['output', 'remap', from],
        message: `must map light indices below nLights (${cfg.nLights})`
      });
      continue;
    }
    if (destinations.has(to)) {
      ctx.addIssue({
        code: 'custom',
        path: ['output', 'remap', from],
        message: `light ${to} is already the destination of another entry`
      });
      continue;
    }
    destinations.add(to);
  }
}

// Validated at startup so a typo in the user-edited config.json fails fast with a
// pointed message instead of surfacing as NaN frames or a crash minutes later.
const configSchema = baseConfigSchema.superRefine(checkRemap);

// The body of a save from the config page: the file's contents minus the password, which
// the browser never receives and only sends when the user is changing it. The scenes
// file stays a plain name here - a path from a request has no business escaping the
// project root, even though it comes from an authenticated editor.
export const configUpdateSchema = z.object({
  settings: baseConfigSchema
    .extend({
      server: serverSchema.omit({ editPassword: true }).extend({
        scenes: z
          .string()
          .min(1)
          .regex(/^[^/\\]+$/, 'must be a file name, without a path')
      })
    })
    .superRefine(checkRemap),
  editPassword: z.string().optional()
});

type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(
      `Could not read config.json at ${configPath}: ${(err as Error).message}`
    );
    process.exit(1);
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    console.error(`Invalid config.json:\n${details}`);
    process.exit(1);
  }
  return result.data;
}

// The live settings. Mutated in place by `saveConfig` rather than replaced, so every
// module that imported it keeps reading the current values - as long as it reads through
// `config` on each use. Anything that copies a value out at startup (the tick timer, the
// listening port, the output pipeline) keeps the old one until the server is restarted;
// those settings are listed in RESTART_REQUIRED_SETTINGS.
export const config: Config = loadConfig();

// The settings the config page edits: everything in the file except the password, which
// is listed out field by field so it cannot be spread back in by accident.
export function currentSettings(): Settings {
  const { nLights, server, output } = config;
  return structuredClone({
    nLights,
    server: {
      tickRate: server.tickRate,
      port: server.port,
      scenes: server.scenes,
      blackoutTransition: server.blackoutTransition,
      halfLightTransition: server.halfLightTransition,
      halfLightFeather: server.halfLightFeather,
      solidColorTransition: server.solidColorTransition,
      sceneTransition: server.sceneTransition
    },
    output
  });
}

export function editPasswordSet(): boolean {
  return config.server.editPassword.trim() !== '';
}

function at(settings: Settings, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], settings);
}

// Write a save from the config page to config.json and adopt it; the update has already
// been validated by `configUpdateSchema`. Returns the paths of the changed settings that
// only take effect after a restart. A failed write leaves the running config alone.
export async function saveConfig(update: ConfigUpdate): Promise<string[]> {
  const { nLights, server, output } = update.settings;
  // Written out in the order the file uses, so a save keeps config.json readable for
  // whoever edits it by hand next.
  const next: Config = {
    nLights,
    server: {
      tickRate: server.tickRate,
      port: server.port,
      scenes: server.scenes,
      // Omitted means "keep the current password"; an empty string clears it.
      editPassword: update.editPassword ?? config.server.editPassword,
      blackoutTransition: server.blackoutTransition,
      halfLightTransition: server.halfLightTransition,
      halfLightFeather: server.halfLightFeather,
      solidColorTransition: server.solidColorTransition,
      sceneTransition: server.sceneTransition
    },
    output
  };

  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

  const previous = currentSettings();
  config.nLights = next.nLights;
  config.server = next.server;
  config.output = next.output;

  return RESTART_REQUIRED_SETTINGS.filter(
    (path) =>
      JSON.stringify(at(previous, path)) !== JSON.stringify(at(update.settings, path))
  );
}
