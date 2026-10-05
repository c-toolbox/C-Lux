import { describe, expect, it } from 'vitest';

import {
  type Clip,
  gateAt,
  mapTracks,
  type Timeline,
  trackOf,
  validateTimeline,
  wrapTime
} from '../shared/timeline';

const clip = (start: number, end: number, fadeIn = 0, fadeOut = 0): Clip => ({
  start,
  end,
  fadeIn,
  fadeOut
});

describe('gateAt', () => {
  it('is off outside every clip and on inside one', () => {
    const clips = [clip(1, 2), clip(4, 6)];
    expect(gateAt(clips, 0.5)).toBe(0);
    expect(gateAt(clips, 1.5)).toBe(1);
    expect(gateAt(clips, 3)).toBe(0);
    expect(gateAt(clips, 6)).toBe(1);
    expect(gateAt(clips, 6.1)).toBe(0);
  });

  it('eases in and out over the fades', () => {
    const clips = [clip(0, 10, 4, 2)];
    expect(gateAt(clips, 0)).toBe(0);
    expect(gateAt(clips, 1)).toBe(0.25);
    expect(gateAt(clips, 5)).toBe(1);
    expect(gateAt(clips, 9)).toBe(0.5);
    expect(gateAt(clips, 10)).toBe(0);
  });

  it('takes the brighter of overlapping clips', () => {
    expect(gateAt([clip(0, 4, 0, 4), clip(2, 6, 4, 0)], 2)).toBe(0.5);
    expect(gateAt([clip(0, 4, 0, 4), clip(1, 6)], 2)).toBe(1);
  });

  it('is off without clips', () => {
    expect(gateAt([], 1)).toBe(0);
  });
});

describe('wrapTime', () => {
  const timeline = (loop: boolean): Timeline => ({ duration: 10, loop, tracks: {} });

  it('wraps a looping timeline around', () => {
    expect(wrapTime(timeline(true), 12.5)).toBe(2.5);
    expect(wrapTime(timeline(true), 10)).toBe(0);
    expect(wrapTime(timeline(true), -1)).toBe(9);
  });

  it('holds a one-shot timeline at either end', () => {
    expect(wrapTime(timeline(false), 12.5)).toBe(10);
    expect(wrapTime(timeline(false), -1)).toBe(0);
    expect(wrapTime(timeline(false), 4)).toBe(4);
  });
});

describe('trackOf', () => {
  it("doesn't mistake Object.prototype for a track", () => {
    const timeline: Timeline = { duration: 1, loop: true, tracks: {} };
    expect(trackOf(timeline, 'constructor')).toBeUndefined();
    expect(trackOf(timeline, 'toString')).toBeUndefined();
  });
});

describe('validateTimeline', () => {
  const valid = {
    duration: 10,
    loop: true,
    tracks: { a: [clip(5, 8), { start: 0, end: 2 }] }
  };

  it('returns a clean copy with sorted clips and default fades', () => {
    expect(validateTimeline({ ...valid, extra: 1 })).toEqual({
      duration: 10,
      loop: true,
      tracks: { a: [clip(0, 2), clip(5, 8)] }
    });
  });

  it('keeps a track for a pattern named __proto__ as a track', () => {
    const raw = JSON.parse(
      '{"duration":5,"loop":false,"tracks":{"__proto__":[{"start":0,"end":1}]}}'
    ) as unknown;
    const timeline = validateTimeline(raw, new Set(['__proto__']));
    expect(trackOf(timeline, '__proto__')).toEqual([clip(0, 1)]);
    expect(Object.getPrototypeOf(timeline.tracks)).toBe(Object.prototype);
  });

  it('only accepts tracks for the given patterns', () => {
    expect(() => validateTimeline(valid, new Set(['b']))).toThrow(/unknown pattern: a/);
    expect(() => validateTimeline(valid, new Set(['a']))).not.toThrow();
  });

  it.each([
    [null, /must be an object/],
    [[], /must be an object/],
    [{ ...valid, duration: 0 }, /duration/],
    [{ ...valid, duration: Infinity }, /duration/],
    [{ ...valid, duration: '10' }, /duration/],
    [{ ...valid, loop: 1 }, /loop/],
    [{ ...valid, tracks: [] }, /tracks must be an object/],
    [{ ...valid, tracks: { a: {} } }, /must be a list/],
    [{ ...valid, tracks: { a: [null] } }, /must be an object/],
    [{ ...valid, tracks: { a: [clip(-1, 2)] } }, /start must be/],
    [{ ...valid, tracks: { a: [clip(2, 2)] } }, /end after it starts/],
    [{ ...valid, tracks: { a: [clip(5, 11)] } }, /within the timeline/],
    [{ ...valid, tracks: { a: [clip(0, 2, 1.5, 1)] } }, /fades must fit/],
    [{ ...valid, tracks: { a: [{ start: 0, end: 1, fadeIn: NaN }] } }, /fadeIn/]
  ])('rejects %o', (raw, message) => {
    expect(() => validateTimeline(raw)).toThrow(message);
  });

  it('caps the number of clips in a track', () => {
    const clips = Array.from({ length: 101 }, (_, i) => clip(i * 0.01, i * 0.01 + 0.005));
    expect(() => validateTimeline({ ...valid, tracks: { a: clips } })).toThrow(
      /at most 100 clips/
    );
  });
});

describe('mapTracks', () => {
  it('renames and drops tracks', () => {
    const timeline: Timeline = {
      duration: 5,
      loop: true,
      tracks: { a: [clip(0, 1)], b: [clip(1, 2)] }
    };
    expect(mapTracks(timeline, (n) => (n === 'a' ? 'c' : null))).toEqual({
      duration: 5,
      loop: true,
      tracks: { c: [clip(0, 1)] }
    });
  });
});
