import { z } from 'zod';

import rawConfig from '../config.json' with { type: 'json' };

// Validated at startup so a typo in the user-edited config.json fails fast with a
// pointed message instead of surfacing as NaN frames or a crash minutes later.
const configSchema = z.object({
  nLights: z.int().positive(),
  server: z.object({
    tickRate: z.number().positive(),
    port: z.int().min(1).max(65535),
    storage: z.string().min(1),
    scenes: z.string().min(1),
    pauseTransition: z.number().nonnegative(),
    blackoutTransition: z.number().nonnegative(),
    halfLightTransition: z.number().nonnegative(),
    halfLightFeather: z.number().positive()
  }),
  output: z.object({
    rotation: z.number(),
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
      refreshRate: z.number().positive()
    })
  })
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
