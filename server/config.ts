import { z } from 'zod';

import rawConfig from '../config.json' with { type: 'json' };

// Validated at startup so a typo in the user-edited config.json fails fast with a
// pointed message instead of surfacing as NaN frames or a crash minutes later.
const configSchema = z
  .object({
    nLights: z.int().positive(),
    server: z.object({
      tickRate: z.number().positive(),
      port: z.int().min(1).max(65535),
      scenes: z.string().min(1),
      // Guards the edit page and the endpoints it drives. May be left empty here and
      // supplied through the CLUX_EDIT_PASSWORD environment variable instead; empty in
      // both places switches the protection off altogether.
      editPassword: z.string().default(''),
      pauseTransition: z.number().nonnegative(),
      blackoutTransition: z.number().nonnegative(),
      halfLightTransition: z.number().nonnegative(),
      halfLightFeather: z.number().positive(),
      solidColorTransition: z.number().nonnegative()
    }),
    output: z.object({
      rotation: z.number(),
      // Fix-ups for lights that were patched to the wrong address: `"5": 3` sends the colour
      // computed for light 5 to light 3 instead. Lights left out keep their 1:1 mapping.
      remap: z
        .record(z.string().regex(/^\d+$/, 'must be a light index'), z.int().nonnegative())
        .default({}),
      dmx: z.object({
        enabled: z.boolean(),
        device: z.string().min(1),
        startChannel: z.int().min(1).max(512),
        refreshRate: z.number().positive()
      }),
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
    for (const [from, to] of Object.entries(cfg.output.remap)) {
      if (Number(from) >= cfg.nLights || to >= cfg.nLights) {
        ctx.addIssue({
          code: 'custom',
          path: ['output', 'remap', from],
          message: `must map light indices below nLights (${cfg.nLights})`
        });
      }
    }
  });

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse(rawConfig);
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
