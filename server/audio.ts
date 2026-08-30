import { z } from 'zod';

import { AUDIO_BANDS, setAudioFrame } from '../shared/audio';

import { HttpError } from './errors';

const clampUnit = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

// The shape a capture client posts. Checked strictly so a malformed post can't feed
// NaN or an unexpected length into the pattern state (zod numbers reject NaN/Infinity).
const audioBodySchema = z.object({
  bands: z
    .array(z.number('bands must contain only finite numbers'))
    .length(AUDIO_BANDS, `bands must be an array of ${AUDIO_BANDS} numbers`),
  level: z.number().finite('level must be a finite number')
});

// Validate and accept one analysis frame from a capture client.
export function publishAudioFrame(body: unknown): void {
  const result = audioBodySchema.safeParse(body ?? {});
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0].message);
  }
  const { bands, level } = result.data;
  setAudioFrame(bands.map(clampUnit), clampUnit(level));
}
