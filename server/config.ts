import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Read from disk at startup rather than imported, so that editing config.json on a
// deployed machine takes effect on the next restart. A JSON import would be inlined into
// the server bundle at build time and the file on disk would then be ignored entirely.
// Resolved relative to the project root, regardless of cwd.
const configPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config.json');

// Validated at startup so a typo in the user-edited config.json fails fast with a
// pointed message instead of surfacing as NaN frames or a crash minutes later.
const configSchema = z
  .object({
    nLights: z.int().positive(),
    server: z.object({
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
    }),
    output: z.object({
      rotation: z.number(),
      // Fix-ups for lights that were patched to the wrong address: `"5": 3` sends the color
      // computed for light 5 to light 3 instead. Lights left out keep their 1:1 mapping, so
      // the lights that are listed have to be a closed shuffle (see the check below).
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
    })
  })
  .superRefine((cfg, ctx) => {
    const sources = new Set<number>();
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
      sources.add(Number(from));
      destinations.add(to);
    }

    // Lights the remap touches have to be shuffled amongst themselves, otherwise a light
    // ends up with two colors fighting over it and another with none at all.
    for (const light of sources) {
      if (!destinations.has(light)) {
        ctx.addIssue({
          code: 'custom',
          path: ['output', 'remap', String(light)],
          message:
            `light ${light} gives its color away but is not given one back, ` +
            `so it would go dark - add an entry that lands on ${light}`
        });
      }
    }
    for (const light of destinations) {
      if (!sources.has(light)) {
        ctx.addIssue({
          code: 'custom',
          path: ['output', 'remap'],
          message:
            `light ${light} is given another light's color but keeps its own too - ` +
            `add an entry sending light ${light} somewhere else`
        });
      }
    }
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

export const config = loadConfig();
