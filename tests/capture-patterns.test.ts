import { beforeEach, describe, expect, it } from 'vitest';

import { AUDIO_BANDS, setAudioFrame } from '../shared/audio';
import { AUDIO_TYPE } from '../shared/patterns/audio';
import { patternFields } from '../shared/patterns/patterns';
import { VIDEO_TYPE } from '../shared/patterns/video';
import { setVideoStrip } from '../shared/video';

import {
  animate,
  build,
  defaultParameters,
  edgeValues,
  mulberry32,
  N_LIGHTS
} from './helpers';

// The capture-driven patterns render nothing without a feed, so these runs publish one
// first to reach their real render paths.
const random = mulberry32(42);

function publishAudio(loudness: number) {
  const bands = Array.from({ length: AUDIO_BANDS }, () => random() * loudness);
  setAudioFrame(bands, loudness);
}

function publishVideo(width: number) {
  const rgb = new Uint8Array(width * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.floor(random() * 256);
  setVideoStrip(width, rgb, 'browser');
}

describe.each([0, 0.5, 1])(
  'Audio pattern with a live feed at loudness %d',
  (loudness) => {
    beforeEach(() => publishAudio(loudness));

    it.each(Object.entries(patternFields(AUDIO_TYPE)!))(
      'renders every edge value of %s',
      (key, spec) => {
        for (const value of edgeValues(spec)) {
          const pattern = build({ ...defaultParameters(AUDIO_TYPE), [key]: value });
          expect(animate(pattern), `${key}=${JSON.stringify(value)}`).toBeNull();
        }
      }
    );
  }
);

describe.each([1, 2, N_LIGHTS - 1, N_LIGHTS, N_LIGHTS * 3 + 1, 1024])(
  'Video pattern with a live %i-pixel strip',
  (width) => {
    beforeEach(() => publishVideo(width));

    it.each(Object.entries(patternFields(VIDEO_TYPE)!))(
      'renders every edge value of %s',
      (key, spec) => {
        for (const value of edgeValues(spec)) {
          const pattern = build({ ...defaultParameters(VIDEO_TYPE), [key]: value });
          expect(animate(pattern), `${key}=${JSON.stringify(value)}`).toBeNull();
        }
      }
    );

    it('fades in once frames arrive', () => {
      const pattern = build(defaultParameters(VIDEO_TYPE));
      for (let i = 0; i < 30; i++) pattern.tick(1 / 30);
      const data = pattern.data();
      expect(data[3]).toBeCloseTo(1);
    });
  }
);
