import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUDIO_BANDS,
  AUDIO_MAX_HZ,
  AUDIO_MIN_HZ,
  audioBandIndex,
  setAudioFrame
} from '../shared/audio';
import { type Color, hsvToRgb } from '../shared/patterns/pattern';
import { setVideoStrip } from '../shared/video';

import { alphas, make, mod, N_LIGHTS as N, rgbAt } from './helpers';

// The capture stores go stale on wall-clock time, so the clock is frozen and moved by hand.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Leave whatever an earlier test published behind as stale.
  vi.setSystemTime(Date.now() + 60_000);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Audio', () => {
  // Lights from the top (light 0) to the bottom of the ring, inclusive.
  const reach = Math.floor(N / 2) + 1;
  const bottom = reach - 1;

  function feed(level: number, bands: (band: number) => number = () => 0) {
    setAudioFrame(
      Array.from({ length: AUDIO_BANDS }, (_, k) => bands(k)),
      level
    );
  }

  const onlyBand = (band: number) => (k: number) => (k === band ? 1 : 0);

  it.each([0, 1, 2])('stays dark on silence in mode %d', (mode) => {
    const p = make('Audio', { mode });
    feed(0);
    p.tick(1 / 30);
    expect(alphas(p).every((a) => a === 0)).toBe(true);
  });

  it('stays dark without any feed', () => {
    const p = make('Audio', { mode: 1, floor: 0 });
    p.tick(1 / 30);
    expect(alphas(p).every((a) => a === 0)).toBe(true);
  });

  describe('spectrum', () => {
    it('shows bass at the top and treble at the bottom', () => {
      const bass = make('Audio', { mode: 0 });
      feed(1, onlyBand(0));
      bass.tick(1 / 30);
      expect(alphas(bass)[0]).toBeCloseTo(1);
      expect(alphas(bass)[bottom]).toBe(0);

      const treble = make('Audio', { mode: 0 });
      feed(1, onlyBand(AUDIO_BANDS - 1));
      treble.tick(1 / 30);
      expect(alphas(treble)[0]).toBe(0);
      expect(alphas(treble)[bottom]).toBeCloseTo(1);
    });

    it('flips when the front and back frequencies swap', () => {
      const p = make('Audio', { mode: 0, frontHz: 16000, backHz: 30 });
      feed(1, onlyBand(0));
      p.tick(1 / 30);
      expect(alphas(p)[0]).toBe(0);
      expect(alphas(p)[bottom]).toBeCloseTo(1);
    });

    it('mirrors both sides of the ring', () => {
      const p = make('Audio', { mode: 0 });
      feed(1, (k) => k / AUDIO_BANDS);
      p.tick(1 / 30);
      const a = alphas(p);
      for (let i = 1; i < N; i++) expect(a[i]).toBeCloseTo(a[N - i]);
    });

    it('interpolates smoothly between bands', () => {
      const p = make('Audio', { mode: 0, floor: 0 });
      feed(1, (k) => k / (AUDIO_BANDS - 1));
      p.tick(1 / 30);
      const a = alphas(p);
      for (let i = 1; i <= bottom; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1]);
      expect(new Set(a.slice(0, reach)).size).toBeGreaterThan(AUDIO_BANDS);
    });
  });

  describe('VU meter', () => {
    const expectFilled = (p: ReturnType<typeof make>, vu: number) => {
      alphas(p).forEach((a, i) => {
        const distance = Math.min(i, N - i);
        expect(a, `light ${i}`).toBeCloseTo(
          Math.min(1, Math.max(0, vu * reach - distance))
        );
      });
    };

    it.each([0.25, 0.5, 0.8, 1])('fills down both sides to level %d', (level) => {
      const p = make('Audio', { mode: 1, floor: 0 });
      feed(level);
      p.tick(1 / 30);
      expectFilled(p, level);
    });

    it('amplifies the input by the gain', () => {
      const p = make('Audio', { mode: 1, floor: 0, gain: 2 });
      feed(0.25);
      p.tick(1 / 30);
      expectFilled(p, 0.5);
    });

    it('clips an amplified level at full', () => {
      const p = make('Audio', { mode: 1, floor: 0, gain: 10 });
      feed(0.5);
      p.tick(1 / 30);
      expectFilled(p, 1);
    });

    it.each([
      [0.04, 0.05, 0],
      [0.75, 0.5, 0.5],
      [1, 0.5, 1],
      [1, 1, 0]
    ])('gates level %d at noise floor %d to %d', (level, floor, vu) => {
      const p = make('Audio', { mode: 1, floor });
      feed(level);
      p.tick(1 / 30);
      expectFilled(p, vu);
    });

    it.each([0, 2, 6, 20])('falls back from a peak at decay %d', (decay) => {
      const p = make('Audio', { mode: 1, floor: 0, decay });
      feed(1);
      p.tick(1 / 30);
      feed(0);
      p.tick(0.1);
      expectFilled(p, Math.exp(-decay * 0.1));
    });

    it('jumps straight up to a new peak', () => {
      const p = make('Audio', { mode: 1, floor: 0, decay: 100 });
      feed(0.2);
      p.tick(1 / 30);
      feed(0.9);
      p.tick(1 / 30);
      expectFilled(p, 0.9);
    });
  });

  describe('single frequency', () => {
    const color = { r: 10, g: 200, b: 30 };
    const single = (overrides: Record<string, unknown> = {}) =>
      make('Audio', { mode: 2, floor: 0, color, ...overrides });

    it.each([
      [AUDIO_MIN_HZ, 0],
      [AUDIO_MAX_HZ, AUDIO_BANDS - 1]
    ])('lights the whole dome with %d Hz in its color', (hz, band) => {
      const p = single({ hz });
      feed(1, onlyBand(band));
      p.tick(1 / 30);
      for (let i = 0; i < N; i++) {
        expect(rgbAt(p, i)).toEqual(color);
        expect(alphas(p)[i]).toBeCloseTo(1);
      }
    });

    it('ignores the other bands', () => {
      const p = single({ hz: AUDIO_MIN_HZ });
      feed(1, (k) => (k === 0 ? 0 : 1));
      p.tick(1 / 30);
      expect(alphas(p).every((a) => a === 0)).toBe(true);
    });

    it('follows the band level and the color alpha', () => {
      const p = single({ hz: AUDIO_MIN_HZ, color: { ...color, a: 0.5 } });
      feed(0, (k) => (k === 0 ? 0.6 : 0));
      p.tick(1 / 30);
      alphas(p).forEach((a) => expect(a).toBeCloseTo(0.3));
    });

    it('interpolates between neighbouring bands', () => {
      const between = AUDIO_MIN_HZ * Math.pow(AUDIO_MAX_HZ / AUDIO_MIN_HZ, 0.5);
      const x = audioBandIndex(between);
      const p = single({ hz: between });
      feed(0, (k) => (k === Math.floor(x) ? 1 : 0));
      p.tick(1 / 30);
      alphas(p).forEach((a) => expect(a).toBeCloseTo(1 - (x - Math.floor(x))));
    });
  });

  describe('colors', () => {
    it('uses a single hue without a hue span', () => {
      const p = make('Audio', { hue: 120, hueSpan: 0 });
      for (let i = 0; i < N; i++) expect(rgbAt(p, i)).toEqual({ r: 0, g: 255, b: 0 });
    });

    it.each([
      [0, 240],
      [60, -60],
      [300, 120]
    ])('runs from hue %d at the top across a span of %d', (hue, hueSpan) => {
      const p = make('Audio', { hue, hueSpan });
      expect(rgbAt(p, 0)).toEqual(hsvToRgb(hue, 1, 1));
      expect(rgbAt(p, bottom)).toEqual(hsvToRgb(hue + hueSpan, 1, 1));
    });

    const red = { r: 255, g: 0, b: 0 };
    const blue = { r: 0, g: 0, b: 255 };

    it('blends from the top color to the bottom color', () => {
      const p = make('Audio', { colorMode: 1, frontColor: red, backColor: blue });
      expect(rgbAt(p, 0)).toEqual(red);
      expect(rgbAt(p, bottom)).toEqual(blue);
      const middle = rgbAt(p, Math.round(bottom / 2));
      expect(middle.r).toBeCloseTo(255 - middle.b);
      expect(middle.g).toBe(0);
    });

    it('follows the color map, whatever order its stops come in', () => {
      const green = { r: 0, g: 255, b: 0 };
      const p = make('Audio', {
        colorMode: 2,
        colorMap: [
          { t: 1, ...blue },
          { t: 0, ...red },
          { t: 0.5, ...green }
        ]
      });
      expect(rgbAt(p, 0)).toEqual(red);
      expect(rgbAt(p, bottom)).toEqual(blue);
      const q = Math.round(bottom / 4);
      const f = q / bottom / 0.5;
      expect(rgbAt(p, q).r).toBeCloseTo(255 * (1 - f));
      expect(rgbAt(p, q).g).toBeCloseTo(255 * f);
    });

    it('holds the end colors outside the map', () => {
      const p = make('Audio', {
        colorMode: 2,
        colorMap: [
          { t: 0.25, ...red },
          { t: 0.75, ...blue }
        ]
      });
      expect(rgbAt(p, 1)).toEqual(red);
      expect(rgbAt(p, bottom - 1)).toEqual(blue);
    });

    it.each([1, 2])(
      'scales the level by the color alpha in color mode %d',
      (colorMode) => {
        const half = { ...red, a: 0.5 };
        const p = make('Audio', {
          mode: 1,
          floor: 0,
          colorMode,
          frontColor: half,
          backColor: half,
          colorMap: [{ t: 0, ...half }]
        });
        feed(1);
        p.tick(1 / 30);
        alphas(p).forEach((a) => expect(a).toBeCloseTo(0.5));
      }
    );

    it('eases a color map edit stop by stop', () => {
      const p = make('Audio', {
        colorMode: 2,
        colorMap: [
          { t: 0, ...red },
          { t: 1, ...red }
        ]
      });
      p.update(
        {
          colorMap: [
            { t: 0, ...blue },
            { t: 1, ...blue }
          ]
        },
        1
      );
      p.advance(0.5);
      expect(rgbAt(p, 0).r).toBeCloseTo(127.5);
      expect(rgbAt(p, 0).b).toBeCloseTo(127.5);
      p.advance(0.5);
      expect(rgbAt(p, 0)).toEqual(blue);
    });
  });
});

describe('Video', () => {
  // A strip whose pixels can be told apart: pixel p carries its own index.
  const pixel = (p: number): Color => ({
    r: p % 256,
    g: (p * 7) % 256,
    b: 255 - (p % 256)
  });

  function publish(width: number, color: (p: number) => Color = pixel) {
    const rgb = new Uint8Array(width * 3);
    for (let p = 0; p < width; p++) {
      const { r, g, b } = color(p);
      rgb.set([r, g, b], p * 3);
    }
    setVideoStrip(width, rgb, 'browser');
  }

  // A sharp, unsmoothed, unprocessed mapping, so each light shows exactly one pixel. The
  // half-light offset keeps every light clear of a pixel boundary.
  const raw = {
    fit: 1,
    smoothing: 0,
    saturation: 1,
    gamma: 1,
    offset: 0.5 / N,
    direction: 1
  };

  function settled(overrides: Record<string, unknown>, width = N, color = pixel) {
    const p = make('Video', { ...raw, ...overrides });
    publish(width, color);
    p.tick(1);
    return p;
  }

  it('stays dark without a feed', () => {
    const p = make('Video');
    p.tick(1);
    expect(alphas(p).every((a) => a === 0)).toBe(true);
  });

  it('fades in once frames arrive', () => {
    const p = make('Video', raw);
    publish(N);
    p.tick(0.2);
    for (const a of alphas(p)) expect(a).toBeCloseTo(0.5);
    p.tick(0.2);
    for (const a of alphas(p)) expect(a).toBeCloseTo(1);
    p.tick(1);
    for (const a of alphas(p)) expect(a).toBe(1);
  });

  it('fades out once the feed goes stale', () => {
    const p = settled({});
    vi.setSystemTime(Date.now() + 1000);
    p.tick(0.2);
    for (const a of alphas(p)) expect(a).toBeCloseTo(0.5);
    p.tick(0.2);
    for (const a of alphas(p)) expect(a).toBe(0);
  });

  it('maps a strip as wide as the ring one pixel per light', () => {
    const p = settled({});
    for (let i = 0; i < N; i++) expect(rgbAt(p, i)).toEqual(pixel(i));
  });

  it('runs the strip the other way counter-clockwise', () => {
    const p = settled({ direction: -1 });
    for (let i = 0; i < N; i++) expect(rgbAt(p, i)).toEqual(pixel(mod(N - i, N)));
  });

  it('turns the strip by the rotation', () => {
    const shift = Math.floor(N / 4);
    // Half a light past `shift`, so every light lands squarely inside one pixel.
    const p = settled({ offset: (shift + 0.5) / N });
    for (let i = 0; i < N; i++) expect(rgbAt(p, i)).toEqual(pixel(mod(i + shift, N)));
  });

  it('samples a wider strip at even intervals', () => {
    const p = settled({ offset: 0.25 / N }, 2 * N);
    for (let i = 0; i < N; i++) expect(rgbAt(p, i)).toEqual(pixel(2 * i));
  });

  it('blends neighbouring pixels with the smooth fit', () => {
    const p = settled({ fit: 0, offset: 0.5 / N });
    for (let i = 0; i < N; i++) {
      const a = pixel(i);
      const b = pixel(mod(i + 1, N));
      const light = rgbAt(p, i);
      for (const ch of ['r', 'g', 'b'] as const) {
        expect(Math.abs(light[ch] - (a[ch] + b[ch]) / 2)).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each([
    [1, false],
    [0, true]
  ])('stretches a two-pixel strip with fit %d', (fit, blends) => {
    const p = settled({ fit }, 2, (px) =>
      px === 0 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }
    );
    const reds = p.state.map((l) => l.r);
    expect(reds.some((r) => r > 0 && r < 255)).toBe(blends);
    expect(Math.max(...reds) - Math.min(...reds)).toBeGreaterThan(240);
  });

  it('turns grey without saturation', () => {
    const p = settled({ saturation: 0 });
    for (const { r, g, b } of p.state) {
      expect(g).toBe(r);
      expect(b).toBe(r);
    }
  });

  it('pushes colors away from grey with more saturation', () => {
    const p = settled({ saturation: 2 }, N, () => ({ r: 200, g: 100, b: 100 }));
    // Luma is 121.26; red doubles its distance above it and clips, green and blue below.
    for (let i = 0; i < N; i++) expect(rgbAt(p, i)).toEqual({ r: 255, g: 79, b: 79 });
  });

  it.each([
    [1, 128],
    [2, 64],
    [0.5, 181]
  ])('applies gamma %d to a mid grey', (gamma, value) => {
    const p = settled({ gamma }, N, () => ({ r: 128, g: 128, b: 128 }));
    for (let i = 0; i < N; i++)
      expect(rgbAt(p, i)).toEqual({ r: value, g: value, b: value });
  });

  it.each([0, 0.2, 1])('eases toward new frames with smoothing %d', (smoothing) => {
    const white = () => ({ r: 255, g: 255, b: 255 });
    const p = make('Video', { ...raw, smoothing });
    publish(N, white);
    p.tick(1 / 30);
    const tau = smoothing * 0.5;
    const expected = 255 * (tau > 0 ? 1 - Math.exp(-1 / 30 / tau) : 1);
    for (const light of p.state) expect(light.r).toBeCloseTo(expected);
  });
});
