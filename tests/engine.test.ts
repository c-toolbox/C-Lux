import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../server/config';
import { Engine } from '../server/engine';
import { HttpError } from '../server/errors';
import { saveScenes } from '../server/storage';
import { BlendMode, type Color } from '../shared/patterns/pattern';
import { SOLID_COLOR_NAME, StaticPattern } from '../shared/patterns/static';
import {
  VIDEO_INPUT_CAMERA,
  VIDEO_INPUT_NDI,
  VIDEO_SAMPLING_FISHEYE,
  VIDEO_SAMPLING_STRIP
} from '../shared/video';

import { defaultParameters, N_LIGHTS as N, propsOf } from './helpers';

// Never let a test overwrite the real scenes.json.
vi.mock('../server/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/storage')>()),
  loadScenes: vi.fn(() => Promise.resolve([])),
  saveScenes: vi.fn(() => Promise.resolve())
}));

// Transitions off, so every change shows up in the very next frame.
const saved = { ...config.server };
beforeEach(() => {
  config.server.sceneTransition = 0;
  config.server.solidColorTransition = 0;
  vi.mocked(saveScenes).mockClear();
});
afterEach(() => {
  Object.assign(config.server, saved);
});

let engine: Engine;
beforeEach(() => {
  engine = new Engine();
});

function addStatic(name: string, color: Color, extra: Record<string, unknown> = {}) {
  const params: Record<string, unknown> = defaultParameters('StaticPattern', name);
  delete params.name;
  engine.addPattern('StaticPattern', {
    ...propsOf({ ...params, color, ...extra }),
    name
  });
}

const lightAt = (frame: number[], i: number) => frame.slice(i * 3, i * 3 + 3);

function expectEveryLight(rgb: number[]) {
  const frame = engine.blend();
  for (let i = 0; i < N; i++) expect(lightAt(frame, i), `light ${i}`).toEqual(rgb);
}

async function expectRejected(
  promise: Promise<unknown> | (() => unknown),
  match: RegExp
) {
  let error: unknown;
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).message).toMatch(match);
}

describe('blend modes', () => {
  const below = { r: 200, g: 100, b: 50 };

  it('alpha-blends a translucent layer over the one below', () => {
    addStatic('bottom', below);
    addStatic('top', { r: 0, g: 0, b: 250, a: 0.4 });
    expectEveryLight([120, 60, 130]);
  });

  it('adds a layer onto the one below, clipping at full', () => {
    addStatic('bottom', below);
    addStatic('top', { r: 100, g: 50, b: 0 }, { blendMode: BlendMode.Additive });
    expectEveryLight([255, 150, 50]);
  });

  it('scales an added layer by its alpha', () => {
    addStatic('bottom', below);
    addStatic('top', { r: 40, g: 40, b: 40, a: 0.5 }, { blendMode: BlendMode.Additive });
    expectEveryLight([220, 120, 70]);
  });

  it('multiplies the layer below by a layer', () => {
    addStatic('bottom', below);
    addStatic('top', { r: 255, g: 0, b: 51 }, { blendMode: BlendMode.Multiply });
    expectEveryLight([200, 0, 10]);
  });

  it('eases a multiplying layer off with its opacity', () => {
    addStatic('bottom', below);
    addStatic(
      'top',
      { r: 255, g: 0, b: 51 },
      { blendMode: BlendMode.Multiply, opacity: 0.5 }
    );
    expectEveryLight([200, 50, 30]);
  });

  it('masks out what is below where a multiplying layer is transparent', () => {
    addStatic('bottom', below);
    addStatic(
      'top',
      { r: 255, g: 255, b: 255 },
      { blendMode: BlendMode.Multiply, start: 0, end: 0.5 }
    );
    const frame = engine.blend();
    for (let i = 0; i < N; i++) {
      expect(lightAt(frame, i), `light ${i}`).toEqual(
        i / N < 0.5 ? [200, 100, 50] : [0, 0, 0]
      );
    }
  });

  it('subtracts a layer from the one below, stopping at black', () => {
    addStatic('bottom', below);
    addStatic('top', { r: 100, g: 200, b: 0 }, { blendMode: BlendMode.Subtract });
    expectEveryLight([100, 0, 50]);
  });

  it('scales a subtracted layer by its alpha', () => {
    addStatic('bottom', below);
    addStatic(
      'top',
      { r: 100, g: 100, b: 100, a: 0.5 },
      { blendMode: BlendMode.Subtract }
    );
    expectEveryLight([150, 50, 0]);
  });

  it('switches blend mode through an update', () => {
    addStatic('bottom', below);
    addStatic('top', { r: 100, g: 50, b: 0 });
    engine.updatePattern('top', { blendMode: BlendMode.Additive });
    expect(engine.listPatterns()[1].blendMode).toBe(BlendMode.Additive);
    for (let i = 0; i < 5; i++) engine.tick(1 / 30);
    expectEveryLight([255, 150, 50]);
  });

  it('dims a translucent solid color over the dark ring', () => {
    engine.setSolidColor({ color: { r: 200, g: 100, b: 50, a: 0.5 }, enabled: true });
    expect(engine.solidColorStatus().target).toEqual({ r: 200, g: 100, b: 50, a: 0.5 });
    expectEveryLight([100, 50, 25]);
  });
});

describe('debug color', () => {
  it('dims a translucent debug color', () => {
    engine.setDebug({ light: 3, color: { r: 200, g: 100, b: 50, a: 0.5 } });
    const frame = engine.blend();
    for (let i = 0; i < N; i++) {
      expect(lightAt(frame, i)).toEqual(i === 3 ? [100, 50, 25] : [0, 0, 0]);
    }
  });

  it('shows an opaque debug color as is', () => {
    engine.setDebug({ light: 0, color: { r: 200, g: 100, b: 50 } });
    expect(lightAt(engine.blend(), 0)).toEqual([200, 100, 50]);
  });
});

describe('renaming a pattern', () => {
  beforeEach(() => {
    addStatic('a', { r: 255, g: 0, b: 0 });
    addStatic('b', { r: 0, g: 255, b: 0 });
  });

  const names = () => engine.listPatterns().map((p) => p.name);

  it('renames in place, keeping the other props', () => {
    const result = engine.updatePattern('a', { name: 'c' });
    expect(result.name).toBe('c');
    expect(names()).toEqual(['c', 'b']);
    expect(engine.listPatterns()[0]).toMatchObject({ color: { r: 255, g: 0, b: 0 } });
  });

  it('renames and edits in one update', () => {
    engine.updatePattern('a', { name: 'c', r: 10 });
    expect(engine.listPatterns()[0]).toMatchObject({ name: 'c', color: { r: 10 } });
  });

  it('accepts its own name', () => {
    engine.updatePattern('a', { name: 'a' });
    expect(names()).toEqual(['a', 'b']);
  });

  it('refuses a taken name without overwrite', async () => {
    await expectRejected(
      () => engine.updatePattern('a', { name: 'b' }),
      /already exists/
    );
    expect(names()).toEqual(['a', 'b']);
  });

  it('replaces the pattern holding the name with overwrite', () => {
    engine.updatePattern('b', { name: 'a' }, true);
    expect(names()).toEqual(['a']);
    expect(engine.listPatterns()[0]).toMatchObject({ color: { r: 0, g: 255, b: 0 } });
  });

  it('refuses the reserved solid color name', async () => {
    await expectRejected(
      () => engine.updatePattern('a', { name: SOLID_COLOR_NAME }, true),
      /reserved/
    );
  });

  it('refuses an invalid name', async () => {
    await expectRejected(() => engine.updatePattern('a', { name: '' }), /./);
    await expectRejected(() => engine.updatePattern('a', { name: 42 }), /./);
  });

  it('no longer counts a scene that used the old name as applied', async () => {
    await engine.saveScene('scene');
    expect(engine.appliedScenes()).toEqual(['scene']);
    engine.updatePattern('a', { name: 'c' });
    expect(engine.appliedScenes()).toEqual([]);
  });

  it('no longer counts a scene that used the replaced pattern as applied', async () => {
    await engine.saveScene('scene');
    engine.updatePattern('a', { name: 'b' }, true);
    expect(engine.appliedScenes()).toEqual([]);
  });
});

describe('renaming a scene', () => {
  beforeEach(async () => {
    addStatic('a', { r: 255, g: 0, b: 0 });
    await engine.saveScene('one');
    engine.clearPatterns();
    addStatic('b', { r: 0, g: 255, b: 0 });
    await engine.saveScene('two');
    vi.mocked(saveScenes).mockClear();
  });

  const names = () => engine.listScenes().map((s) => s.name);

  it('refuses a taken name without overwrite', async () => {
    await expectRejected(engine.renameScene('one', 'two'), /already exists/);
    expect(names()).toEqual(['one', 'two']);
    expect(saveScenes).not.toHaveBeenCalled();
  });

  it('replaces the scene holding the name with overwrite', async () => {
    await engine.renameScene('one', 'two', true);
    expect(names()).toEqual(['two']);
    expect(engine.listScenes()[0].patterns.map((p) => p.name)).toEqual(['a']);
    expect(saveScenes).toHaveBeenCalledOnce();
  });

  it('drops the replaced scene from the applied ones', async () => {
    expect(engine.appliedScenes()).toEqual(['two']);
    await engine.renameScene('one', 'two', true);
    expect(engine.appliedScenes()).toEqual([]);
  });

  it('carries the applied state over to the new name', async () => {
    await engine.renameScene('two', 'three');
    expect(names()).toEqual(['one', 'three']);
    expect(engine.appliedScenes()).toEqual(['three']);
  });

  it('still refuses an unknown scene with overwrite', async () => {
    await expectRejected(engine.renameScene('nope', 'two', true), /No scene named/);
    expect(names()).toEqual(['one', 'two']);
  });
});

describe('video capture', () => {
  function addVideo(name: string, extra: Record<string, unknown> = {}) {
    const params: Record<string, unknown> = defaultParameters('Video', name);
    delete params.name;
    engine.addPattern('Video', { ...propsOf({ ...params, ...extra }), name });
  }

  it('asks for nothing without an enabled Video pattern', () => {
    addStatic('static', { r: 0, g: 0, b: 0 });
    expect(engine.videoCaptures().size).toBe(0);
    addVideo('video');
    engine.setPatternEnabled('video', false);
    expect(engine.videoCaptures().size).toBe(0);
  });

  it('captures for every enabled Video pattern', () => {
    addVideo('first', { input: VIDEO_INPUT_NDI, ndiSource: 'A', radius: 0.5 });
    addVideo('second', { input: VIDEO_INPUT_CAMERA, sampling: VIDEO_SAMPLING_STRIP });
    addVideo('off');
    engine.setPatternEnabled('off', false);

    const captures = engine.videoCaptures();
    expect([...captures.keys()]).toEqual(['first', 'second']);
    expect(captures.get('first')).toMatchObject({
      input: VIDEO_INPUT_NDI,
      ndiSource: 'A',
      sampling: VIDEO_SAMPLING_FISHEYE,
      geometry: { radius: 0.5 }
    });
    expect(captures.get('second')).toMatchObject({
      input: VIDEO_INPUT_CAMERA,
      sampling: VIDEO_SAMPLING_STRIP
    });
  });

  it('re-aims at once while the edit is still easing in', () => {
    config.server.sceneTransition = 1;
    addVideo('video', { input: VIDEO_INPUT_NDI, ndiSource: 'A' });
    engine.updatePattern('video', { ndiSource: 'B', centerX: 0.25 });
    expect(engine.videoCaptures().get('video')).toMatchObject({
      ndiSource: 'B',
      geometry: { centerX: 0.25 }
    });
  });

  it('only accepts feeds for running patterns of the right type', () => {
    addVideo('video');
    addStatic('static', { r: 0, g: 0, b: 0 });
    expect(engine.acceptsFeed('video', 'Video')).toBe(true);
    expect(engine.acceptsFeed('video', 'Audio')).toBe(false);
    expect(engine.acceptsFeed('static', 'Video')).toBe(false);
    expect(engine.acceptsFeed('nope', 'Video')).toBe(false);
  });

  it('rejects an NDI source name with control characters', () => {
    addVideo('video');
    expect(() => engine.updatePattern('video', { ndiSource: 'A\nB' })).toThrow(
      /control characters/
    );
  });
});

describe('scene timelines', () => {
  const red = { r: 255, g: 0, b: 0 };
  const green = { r: 0, g: 255, b: 0 };
  const clip = (start: number, end: number, fadeIn = 0, fadeOut = 0) => ({
    start,
    end,
    fadeIn,
    fadeOut
  });
  const timeline = (tracks: Record<string, ReturnType<typeof clip>[]>, loop = true) => ({
    duration: 10,
    loop,
    tracks
  });
  const playback = (scene: string) =>
    engine.listTimelines().find((t) => t.scene === scene);

  beforeEach(async () => {
    addStatic('a', red);
    await engine.saveScene('one');
  });

  it('switches a pattern on and off over time', () => {
    engine.setTimeline('one', timeline({ a: [clip(0, 5)] }));
    expectEveryLight([255, 0, 0]);
    engine.tick(6);
    expectEveryLight([0, 0, 0]);
    engine.tick(5);
    expect(playback('one')!.time).toBeCloseTo(1);
    expectEveryLight([255, 0, 0]);
  });

  it('fades a pattern in', () => {
    engine.setTimeline('one', timeline({ a: [clip(0, 10, 4)] }));
    engine.tick(2);
    expectEveryLight([128, 0, 0]);
  });

  it('eases a multiplying layer off as it fades out', () => {
    engine.clearPatterns();
    addStatic('bottom', { r: 200, g: 100, b: 50 });
    addStatic('a', { r: 255, g: 0, b: 51 }, { blendMode: BlendMode.Multiply });
    engine.setTimeline('one', timeline({ a: [clip(0, 10, 0, 10)] }));
    engine.tick(5);
    expectEveryLight([200, 50, 30]);
  });

  it('leaves patterns without a track alone', () => {
    addStatic('b', green, { start: 0, end: 0.5 });
    engine.setTimeline('one', timeline({ a: [clip(5, 10)] }));
    const frame = engine.blend();
    expect(lightAt(frame, 0)).toEqual([0, 255, 0]);
    expect(lightAt(frame, N - 1)).toEqual([0, 0, 0]);
  });

  it('pauses, seeks and restarts', () => {
    engine.setTimeline('one', timeline({ a: [clip(0, 5)] }));
    engine.controlTimeline('one', { playing: false });
    engine.tick(6);
    expectEveryLight([255, 0, 0]);
    engine.controlTimeline('one', { time: 7 });
    expectEveryLight([0, 0, 0]);
    expect(playback('one')).toMatchObject({ time: 7, playing: false });
    engine.controlTimeline('one', { time: 0, playing: true });
    engine.tick(1);
    expect(playback('one')).toMatchObject({ time: 1, playing: true });
  });

  it('stops a one-shot timeline at its end and plays it over', () => {
    engine.setTimeline('one', timeline({ a: [clip(0, 5)] }, false));
    engine.tick(12);
    expect(playback('one')).toMatchObject({ time: 10, playing: false });
    engine.controlTimeline('one', { playing: true });
    expect(playback('one')).toMatchObject({ time: 0, playing: true });
  });

  it('holds a pattern still while it is switched off', () => {
    engine.setTimeline('one', timeline({ a: [clip(5, 10)] }));
    const tick = vi.spyOn(StaticPattern.prototype, 'tick');
    engine.tick(1);
    // Only the solid color layer ticked.
    expect(tick).toHaveBeenCalledOnce();
    engine.controlTimeline('one', { time: 6 });
    tick.mockClear();
    engine.tick(1);
    expect(tick).toHaveBeenCalledTimes(2);
    tick.mockRestore();
  });

  it('lights a pattern timed by two scenes as the brighter has it', async () => {
    await engine.saveScene('two');
    engine.setTimeline('one', timeline({ a: [clip(0, 2)] }));
    engine.setTimeline('two', timeline({ a: [clip(4, 6)] }));
    engine.controlTimeline('two', { time: 3 });
    expectEveryLight([255, 0, 0]);
    engine.tick(2);
    expectEveryLight([255, 0, 0]);
    engine.tick(2);
    expectEveryLight([0, 0, 0]);
  });

  it('takes over from the manual switch', async () => {
    engine.setPatternEnabled('a', false);
    engine.setTimeline('one', timeline({ a: [clip(0, 5)] }));
    expect(engine.listPatterns()[0].enabled).toBe(true);
    await expectRejected(() => engine.setPatternEnabled('a', false), /timeline/);
  });

  it('rejects a track for a pattern that is not running', async () => {
    await expectRejected(
      () => engine.setTimeline('one', timeline({ b: [clip(0, 5)] })),
      /unknown pattern: b/
    );
    await expectRejected(() => engine.setTimeline('one', { duration: -1 }), /duration/);
    await expectRejected(() => engine.setTimeline('nope', timeline({})), /No scene/);
    expect(engine.listTimelines()).toEqual([]);
  });

  it('refuses to control a scene without a running timeline', async () => {
    await expectRejected(
      () => engine.controlTimeline('one', { playing: true }),
      /no running timeline/
    );
  });

  it('saves the timeline with the scene, keeping only its own tracks', async () => {
    addStatic('b', green);
    engine.setTimeline('one', timeline({ a: [clip(0, 5)], b: [clip(1, 2)] }));
    engine.removePattern('b');
    await engine.saveScene('one');
    expect(engine.listScenes()[0].timeline).toEqual(timeline({ a: [clip(0, 5)] }));
  });

  it('plays the saved timeline from the start when the scene is applied', async () => {
    engine.setTimeline('one', timeline({ a: [clip(0, 5)] }));
    engine.tick(3);
    await engine.saveScene('one');

    engine.unapplyScene('one');
    expect(engine.listTimelines()).toEqual([]);
    engine.applyScene('one');
    expect(playback('one')).toMatchObject({ time: 0, playing: true });
    engine.tick(3);
    engine.replaceWithScene('one');
    expect(playback('one')).toMatchObject({ time: 0, playing: true });
  });

  it('removes a timeline, and drops it from the scene on the next save', async () => {
    engine.setTimeline('one', timeline({ a: [clip(5, 10)] }));
    await engine.saveScene('one');
    engine.removeTimeline('one');
    expect(engine.listTimelines()).toEqual([]);
    expectEveryLight([255, 0, 0]);
    expect(engine.setPatternEnabled('a', false).enabled).toBe(false);

    await engine.saveScene('one');
    expect(engine.listScenes()[0].timeline).toBeUndefined();
  });

  it('brings a removed timeline back when the scene is applied again', async () => {
    engine.setTimeline('one', timeline({ a: [clip(5, 10)] }));
    await engine.saveScene('one');
    engine.removeTimeline('one');
    engine.replaceWithScene('one');
    expect(playback('one')).toMatchObject({ time: 0, playing: true });
    await engine.saveScene('one');
    expect(engine.listScenes()[0].timeline).toBeDefined();
  });

  it('stops the timelines when the patterns are cleared', () => {
    engine.setTimeline('one', timeline({ a: [clip(0, 5)] }));
    engine.clearPatterns();
    expect(engine.listTimelines()).toEqual([]);
  });

  it('carries a track over a pattern rename', () => {
    engine.setTimeline('one', timeline({ a: [clip(0, 5)] }));
    engine.updatePattern('a', { name: 'c' });
    expect(playback('one')!.timeline.tracks).toEqual({ c: [clip(0, 5)] });
  });

  it('drops the track of a pattern replaced by a rename', () => {
    addStatic('b', green);
    engine.setTimeline('one', timeline({ a: [clip(0, 5)], b: [clip(5, 10)] }));
    engine.updatePattern('a', { name: 'b' }, true);
    expect(playback('one')!.timeline.tracks).toEqual({ b: [clip(0, 5)] });
  });

  it('follows a scene rename and goes with a deleted scene', async () => {
    engine.setTimeline('one', timeline({ a: [clip(0, 5)] }));
    await engine.renameScene('one', 'renamed');
    expect(engine.listTimelines().map((t) => t.scene)).toEqual(['renamed']);
    await engine.deleteScene('renamed');
    expect(engine.listTimelines()).toEqual([]);
  });

  it('imports a scene with its timeline', async () => {
    const [scene] = engine.listScenes();
    const imported = timeline({ a: [clip(0, 5)] });
    await engine.importScene({ ...scene, version: 2, timeline: imported });
    expect(engine.listScenes().at(-1)!.timeline).toEqual(imported);
  });

  it('rejects an import whose timeline names a pattern it lacks', async () => {
    const [scene] = engine.listScenes();
    vi.mocked(saveScenes).mockClear();
    await expectRejected(
      engine.importScene({ ...scene, timeline: timeline({ b: [clip(0, 5)] }) }),
      /unknown pattern: b/
    );
    expect(saveScenes).not.toHaveBeenCalled();
  });
});
