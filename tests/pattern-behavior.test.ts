import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Color, hsvToRgb } from '../shared/patterns/pattern';
import { StaticPattern } from '../shared/patterns/static';

import {
  alphas,
  argmax,
  countRuns,
  litLights,
  localMaxima,
  make,
  mod,
  mulberry32,
  N_LIGHTS as N,
  rgbAt,
  run
} from './helpers';

const RED: Color = { r: 255, g: 0, b: 0 };
const GREEN: Color = { r: 0, g: 255, b: 0 };
const BLUE: Color = { r: 0, g: 0, b: 255 };
const BLACK: Color = { r: 0, g: 0, b: 0 };
const WHITE: Color = { r: 255, g: 255, b: 255 };

// Patterns that roll dice get a seeded generator, so every run sees the same sequence.
function seedRandom(seed = 1) {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(seed));
}

function fixRandom(value: number) {
  vi.spyOn(Math, 'random').mockReturnValue(value);
}

afterEach(() => {
  vi.restoreAllMocks();
});

const allColored = (pattern: ReturnType<typeof make>, color: Color) => {
  for (let i = 0; i < N; i++) expect(rgbAt(pattern, i), `light ${i}`).toEqual(color);
};

const snapshot = (pattern: ReturnType<typeof make>) =>
  pattern.state.map((light) => ({ ...light }));

describe('Static', () => {
  it('lights the whole ring in its color and holds still', () => {
    const p = make('StaticPattern', { color: RED });
    expect(alphas(p).every((a) => a === 1)).toBe(true);
    allColored(p, RED);
    run(p, 5);
    expect(alphas(p).every((a) => a === 1)).toBe(true);
    allColored(p, RED);
  });

  it.each([
    [0.25, 0.5],
    [0, 0.5],
    [0.5, 1],
    [0.75, 0.25],
    [0.9, 0.1]
  ])('lights only the range %d to %d', (start, end) => {
    const p = make('StaticPattern', { start, end });
    alphas(p).forEach((a, i) => {
      const pos = i / N;
      const inside = start < end ? pos >= start && pos < end : pos >= start || pos < end;
      expect(a, `light ${i}`).toBe(inside ? 1 : 0);
    });
  });

  it('lights everything when start equals end', () => {
    const p = make('StaticPattern', { start: 0.3, end: 0.3 });
    expect(alphas(p).every((a) => a === 1)).toBe(true);
  });

  it('fades to a new color over the given duration', () => {
    const p = make('StaticPattern', { color: BLACK }) as StaticPattern;
    p.fadeTo({ r: 200, g: 100, b: 50 }, 2);
    expect(p.parameters().color).toEqual({ r: 200, g: 100, b: 50, a: 1 });

    p.tick(1);
    allColored(p, { r: 100, g: 50, b: 25 });
    p.tick(1);
    allColored(p, { r: 200, g: 100, b: 50 });
    p.tick(1);
    allColored(p, { r: 200, g: 100, b: 50 });
  });

  it('switches at once for a fade without duration', () => {
    const p = make('StaticPattern', { color: BLACK }) as StaticPattern;
    p.fadeTo(GREEN, 0);
    allColored(p, GREEN);
  });

  it('lights the ring at its color alpha', () => {
    const p = make('StaticPattern', { color: { ...RED, a: 0.25 } });
    expect(alphas(p).every((a) => a === 0.25)).toBe(true);
    allColored(p, RED);
  });

  it('fades the alpha along with the color', () => {
    const p = make('StaticPattern', { color: RED }) as StaticPattern;
    p.fadeTo({ ...RED, a: 0 }, 2);
    p.tick(1);
    expect(alphas(p).every((a) => a === 0.5)).toBe(true);
    p.tick(1);
    expect(alphas(p).every((a) => a === 0)).toBe(true);
  });

  it('treats a color without alpha as opaque', () => {
    const p = make('StaticPattern', { color: { ...RED, a: 0 } }) as StaticPattern;
    p.fadeTo(GREEN, 0);
    expect(p.parameters().color).toEqual({ ...GREEN, a: 1 });
    expect(alphas(p).every((a) => a === 1)).toBe(true);
  });

  it('eases an alpha-only edit', () => {
    const p = make('StaticPattern', { color: RED });
    p.update({ color: { ...RED, a: 0 } }, 1);
    p.advance(0.5);
    alphas(p).forEach((a) => expect(a).toBeCloseTo(0.5));
    p.advance(0.5);
    expect(alphas(p).every((a) => a === 0)).toBe(true);
  });

  it('starts a new fade from the color currently lit', () => {
    const p = make('StaticPattern', { color: BLACK }) as StaticPattern;
    p.fadeTo(WHITE, 2);
    p.tick(1);
    allColored(p, { r: 128, g: 128, b: 128 });
    p.fadeTo(BLACK, 1);
    p.tick(0.5);
    allColored(p, { r: 64, g: 64, b: 64 });
  });
});

describe('MovingGaussian', () => {
  it('centers the bump on the origin and falls off symmetrically', () => {
    const k = Math.floor(N / 4);
    const p = make('MovingGaussian', { origin: k / N, speed: 0 });
    const a = alphas(p);
    expect(argmax(a)).toBe(k);
    expect(a[k]).toBeCloseTo(1);
    for (let d = 1; d < 10; d++) {
      expect(a[k + d]).toBeCloseTo(a[k - d]);
      expect(a[k + d]).toBeLessThan(a[k + d - 1]);
    }
  });

  it.each([0.02, 0.04, 0.1, 0.3])('spreads the bump by sigma %d', (sigma) => {
    const p = make('MovingGaussian', { sigma, origin: 0, speed: 0 });
    const a = alphas(p);
    for (const d of [1, 3, 8]) {
      expect(a[d]).toBeCloseTo(Math.exp(-(d * d) / (2 * (sigma * N) ** 2)), 6);
    }
  });

  it('lights only the origin with a zero sigma', () => {
    const p = make('MovingGaussian', { sigma: 0, origin: 0, speed: 0 });
    expect(litLights(p)).toEqual([0]);
  });

  it('holds still without speed', () => {
    const p = make('MovingGaussian', { speed: 0 });
    const before = alphas(p);
    run(p, 3);
    expect(alphas(p)).toEqual(before);
  });

  it.each([
    [5.5 / N, 5],
    [-5.5 / N, N - 5]
  ])('moves whole lights at speed %d', (speed, expected) => {
    const p = make('MovingGaussian', { speed, origin: 0 });
    p.tick(1);
    expect(argmax(alphas(p))).toBe(expected);
  });

  it('carries sub-light movement over between ticks', () => {
    const p = make('MovingGaussian', { speed: 0.4 / N, origin: 0 });
    p.tick(1);
    p.tick(1);
    expect(argmax(alphas(p))).toBe(0);
    p.tick(1);
    expect(argmax(alphas(p))).toBe(1);
  });

  it('travels the same way as the other patterns', () => {
    const gaussian = make('MovingGaussian', { speed: 10 / N, origin: 0, sigma: 0.02 });
    const bounce = make('Bounce', { speed: 10 / N, sigma: 0.02 });
    gaussian.tick(1);
    bounce.tick(1);
    expect(argmax(alphas(gaussian))).toBe(argmax(alphas(bounce)));
  });

  it('comes back to the origin after a full turn', () => {
    const p = make('MovingGaussian', { speed: 1, origin: 0 });
    p.tick(1);
    expect(argmax(alphas(p))).toBe(0);
  });

  it('paints every light in its color', () => {
    allColored(make('MovingGaussian', { color: GREEN }), GREEN);
  });
});

describe('Sparkle', () => {
  beforeEach(() => seedRandom());

  it('stays dark at zero density', () => {
    const p = make('Sparkle', { density: 0 });
    run(p, 3);
    expect(litLights(p)).toEqual([]);
  });

  it('ignites more lights at a higher density', () => {
    const sparse = make('Sparkle', { density: 0.1, decay: 0 });
    const dense = make('Sparkle', { density: 0.5, decay: 0 });
    sparse.tick(1);
    dense.tick(1);
    // `density` ring shares per second, minus the odd light hit twice.
    expect(litLights(sparse).length).toBeGreaterThanOrEqual(8);
    expect(litLights(sparse).length).toBeLessThanOrEqual(15);
    expect(litLights(dense).length).toBeGreaterThanOrEqual(40);
    expect(litLights(dense).length).toBeLessThanOrEqual(71);
  });

  it('ignites sparkles at full brightness', () => {
    const p = make('Sparkle', { density: 1 });
    p.tick(1 / 30);
    expect(Math.max(...alphas(p))).toBe(1);
  });

  it.each([0, 1, 3, 10])('fades sparkles at decay %d', (decay) => {
    const p = make('Sparkle', { density: 1, decay });
    p.tick(1 / 30);
    p.update({ density: 0 });
    const before = alphas(p);
    p.tick(0.5);
    alphas(p).forEach((a, i) =>
      expect(a).toBeCloseTo(before[i] * Math.exp(-decay * 0.5))
    );
  });

  it('sparkles white without saturation', () => {
    const p = make('Sparkle', { density: 1, saturation: 0, hue: 200, hueRange: 360 });
    run(p, 1);
    for (const i of litLights(p)) expect(rgbAt(p, i)).toEqual(WHITE);
  });

  it('sparkles in the configured hue', () => {
    const p = make('Sparkle', { density: 1, saturation: 1, hue: 120, hueRange: 0 });
    run(p, 1);
    expect(litLights(p).length).toBeGreaterThan(0);
    for (const i of litLights(p)) expect(rgbAt(p, i)).toEqual(GREEN);
  });

  it('draws from the whole hue range', () => {
    const p = make('Sparkle', { density: 1, decay: 0, saturation: 1, hueRange: 360 });
    run(p, 1);
    const colors = new Set(litLights(p).map((i) => JSON.stringify(rgbAt(p, i))));
    expect(colors.size).toBeGreaterThan(20);
  });

  // A density of one light per second over a one second tick ignites exactly one light,
  // the one `Math.random` picks, without rolling for whether to ignite at all.
  const one = { density: 1 / N, saturation: 1 };

  it.each([
    [0, 0, 60],
    [0.5, Math.floor(N / 2), 120],
    [0.999999, N - 1, 180]
  ])('centers the hue window on the hue (random %d)', (value, light, hue) => {
    fixRandom(value);
    const p = make('Sparkle', { ...one, hue: 120, hueRange: 120 });
    p.tick(1);
    expect(litLights(p)).toEqual([light]);
    const { r, g, b } = hsvToRgb(hue, 1, 1);
    const lit = rgbAt(p, light);
    expect(Math.abs(lit.r - r) + Math.abs(lit.g - g) + Math.abs(lit.b - b)).toBeLessThan(
      3
    );
  });

  it('wraps a hue window that crosses 0°', () => {
    fixRandom(0);
    const p = make('Sparkle', { ...one, hue: 0, hueRange: 120 });
    p.tick(1);
    expect(rgbAt(p, 0)).toEqual(hsvToRgb(300, 1, 1));
  });

  it.each([0.5, 1, 2])('fades sparkles in over an attack of %d s', (attack) => {
    fixRandom(0);
    const p = make('Sparkle', { ...one, attack, decay: 0 });
    p.tick(1);
    // Ignited at the end of the tick, the light has not started to rise yet.
    expect(alphas(p)[0]).toBe(0);
    p.update({ density: 0 });
    p.tick(attack / 4);
    expect(alphas(p)[0]).toBeCloseTo(0.25);
    p.tick(attack / 2);
    expect(alphas(p)[0]).toBeCloseTo(0.75);
    p.tick(attack);
    expect(alphas(p)[0]).toBe(1);
  });

  it('decays once the attack has peaked', () => {
    fixRandom(0);
    const p = make('Sparkle', { ...one, attack: 1, decay: 2 });
    p.tick(1);
    p.update({ density: 0 });
    p.tick(1);
    expect(alphas(p)[0]).toBe(1);
    p.tick(0.5);
    expect(alphas(p)[0]).toBeCloseTo(Math.exp(-1));
  });

  it('rises from the current brightness when re-ignited', () => {
    fixRandom(0);
    const p = make('Sparkle', { ...one, attack: 0, decay: Math.LN2 });
    p.tick(1);
    expect(alphas(p)[0]).toBe(1);
    p.update({ density: 0 });
    p.tick(1);
    expect(alphas(p)[0]).toBeCloseTo(0.5);
    p.update({ density: 1 / N, attack: 1 });
    p.tick(1);
    // Decayed to a quarter, then re-ignited without dipping to dark.
    expect(alphas(p)[0]).toBeCloseTo(0.25);
    p.update({ density: 0 });
    p.tick(0.5);
    expect(alphas(p)[0]).toBeCloseTo(0.75);
  });
});

describe('Rainbow', () => {
  it.each([0, 1, 2, 3.5])('spreads %d spectrum cycles around the ring', (cycles) => {
    const p = make('Rainbow', { cycles });
    p.state.forEach((light, i) => {
      expect(light).toEqual({ ...hsvToRgb((i / N) * 360 * cycles, 1, 1), a: 1 });
    });
  });

  it('starts at red on light 0', () => {
    expect(rgbAt(make('Rainbow'), 0)).toEqual(RED);
  });

  it.each([
    [60, GREEN],
    [-60, BLUE]
  ])('scrolls the hue at %d°/s', (speed, color) => {
    const p = make('Rainbow', { speed });
    p.tick(2);
    expect(rgbAt(p, 0)).toEqual(color);
  });

  it('holds still without speed', () => {
    const p = make('Rainbow', { speed: 0 });
    const before = snapshot(p);
    run(p, 3);
    expect(p.state).toEqual(before);
  });

  it('applies saturation and value', () => {
    allColored(make('Rainbow', { saturation: 0, value: 0.5 }), {
      r: 128,
      g: 128,
      b: 128
    });
    allColored(make('Rainbow', { value: 0 }), BLACK);
  });
});

describe('SineWave', () => {
  it('keeps the brightness between min and max', () => {
    const p = make('SineWave', { min: 0.2, max: 0.6 });
    run(p, 2);
    const a = alphas(p);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0.2 - 1e-9);
    expect(Math.max(...a)).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(Math.min(...a)).toBeLessThan(0.21);
    expect(Math.max(...a)).toBeGreaterThan(0.59);
  });

  it('is flat when min equals max', () => {
    const p = make('SineWave', { min: 0.4, max: 0.4 });
    run(p, 1);
    for (const a of alphas(p)) expect(a).toBeCloseTo(0.4);
  });

  it.each([
    [1, 1],
    [0.5, 2],
    [0.3, 3],
    [0.14, 7],
    [0.1, 10],
    [0.05, 20]
  ])('fits wavelength %d as %d whole waves', (wavelength, waves) => {
    expect(localMaxima(alphas(make('SineWave', { wavelength })))).toHaveLength(waves);
  });

  it.each([
    [5 / N, 5],
    [-5 / N, -5]
  ])('travels at speed %d', (speed, shift) => {
    const p = make('SineWave', { speed });
    const before = alphas(p);
    p.tick(1);
    alphas(p).forEach((a, i) => expect(a).toBeCloseTo(before[mod(i - shift, N)], 6));
  });

  it('paints every light in its color', () => {
    allColored(make('SineWave', { color: BLUE }), BLUE);
  });
});

describe('Comet', () => {
  const tailOf = (tail: number) => tail * N;

  it('moves the head forward at its speed, trailing a fading tail', () => {
    const p = make('Comet', { speed: 10.5 / N, tail: 0.06 });
    p.tick(1);
    const a = alphas(p);
    expect(argmax(a)).toBe(10);
    expect(a[11]).toBeLessThan(1e-3);
    for (let d = 0; d <= 10; d++) {
      expect(a[10 - d]).toBeCloseTo(Math.exp(-(0.5 + d) / tailOf(0.06)), 6);
    }
  });

  it('moves the other way backward', () => {
    const p = make('Comet', { speed: 10.5 / N, direction: -1 });
    p.tick(1);
    const a = alphas(p);
    expect(argmax(a)).toBe(N - 10);
    expect(a[N - 9]).toBeGreaterThan(a[N - 11]);
  });

  it('draws a longer tail for a larger tail setting', () => {
    const short = make('Comet', { speed: 20.5 / N, tail: 0.02 });
    const long = make('Comet', { speed: 20.5 / N, tail: 0.2 });
    short.tick(1);
    long.tick(1);
    expect(litLights(long, 0.1).length).toBeGreaterThan(litLights(short, 0.1).length);
    expect(alphas(long)[15]).toBeGreaterThan(alphas(short)[15]);
  });

  it.each([
    [1, 0.1, 0.3],
    [-1, 0.3, 0.1]
  ])('stays on the arc in direction %d from %d to %d', (direction, start, end) => {
    const p = make('Comet', { speed: 0.1, direction, start, end });
    const peak = new Array<number>(N).fill(0);
    for (let f = 0; f < 600; f++) {
      p.tick(1 / 60);
      alphas(p).forEach((a, i) => (peak[i] = Math.max(peak[i], a)));
    }
    const low = Math.min(start, end) * N;
    const high = Math.max(start, end) * N;
    peak.forEach((a, i) => {
      if (i < low || i > high) expect(a, `light ${i}`).toBe(0);
    });
    // The head reaches the far end of the arc before it restarts.
    const far = direction > 0 ? Math.floor(high) : Math.ceil(low);
    expect(peak[far]).toBeGreaterThan(0.9);
  });

  it('paints every light in its color', () => {
    allColored(make('Comet', { color: RED }), RED);
  });
});

describe('Bounce', () => {
  it('starts at light 0 and travels at its speed', () => {
    const p = make('Bounce', { speed: 10 / N });
    expect(argmax(alphas(p))).toBe(0);
    p.tick(1);
    expect(argmax(alphas(p))).toBe(10);
    expect(alphas(p)[10]).toBeCloseTo(1);
  });

  it('turns around after a full turn in each direction', () => {
    const p = make('Bounce', { speed: 1 });
    p.tick(1 + 10 / N);
    expect(argmax(alphas(p))).toBe(N - 10);
    p.tick(5 / N);
    expect(argmax(alphas(p))).toBe(N - 15);
    p.tick((N - 15 + 10) / N);
    expect(argmax(alphas(p))).toBe(10);
    p.tick(5 / N);
    expect(argmax(alphas(p))).toBe(15);
  });

  it.each([0.02, 0.04, 0.1])('spreads the bump by sigma %d', (sigma) => {
    const a = alphas(make('Bounce', { sigma }));
    for (const d of [1, 3, 8]) {
      expect(a[d]).toBeCloseTo(Math.exp(-(d * d) / (2 * (sigma * N) ** 2)), 6);
      expect(a[N - d]).toBeCloseTo(a[d], 6);
    }
  });

  it('lights a single light with a zero sigma', () => {
    expect(litLights(make('Bounce', { sigma: 0 }))).toEqual([0]);
  });

  it('holds still without speed', () => {
    const p = make('Bounce', { speed: 0 });
    run(p, 3);
    expect(argmax(alphas(p))).toBe(0);
  });

  it('bounces off the seam with a negative speed', () => {
    const p = make('Bounce', { speed: -10 / N });
    p.tick(1);
    expect(argmax(alphas(p))).toBe(10);
    p.tick(1);
    expect(argmax(alphas(p))).toBe(20);
    p.tick(1);
    expect(argmax(alphas(p))).toBe(30);
  });

  it('moves the same way with a negative speed, reflecting off the seam first', () => {
    const forward = make('Bounce', { speed: 0.3 });
    const backward = make('Bounce', { speed: -0.3 });
    for (let i = 0; i < 20; i++) {
      forward.tick(0.37);
      backward.tick(0.37);
      expect(alphas(backward), `tick ${i}`).toEqual(alphas(forward));
    }
  });

  it('scales the bump by its color alpha', () => {
    const a = alphas(make('Bounce', { color: { ...GREEN, a: 0.5 } }));
    expect(a[0]).toBeCloseTo(0.5);
    expect(Math.max(...a)).toBeCloseTo(0.5);
  });

  it('paints every light in its color', () => {
    allColored(make('Bounce', { color: GREEN }), GREEN);
  });
});

describe('Pulse', () => {
  it('breathes between min and max over its period', () => {
    const p = make('Pulse', { period: 2, min: 0.2, max: 0.8 });
    const uniform = (value: number) => {
      for (const a of alphas(p)) expect(a).toBeCloseTo(value);
    };
    uniform(0.2);
    p.tick(0.5);
    uniform(0.5);
    p.tick(0.5);
    uniform(0.8);
    p.tick(1);
    uniform(0.2);
  });

  it.each([1, 4, 10])('repeats every %d seconds', (period) => {
    const p = make('Pulse', { period, min: 0, max: 1 });
    p.tick(period / 2);
    expect(alphas(p)[0]).toBeCloseTo(1);
    p.tick(period / 2);
    expect(alphas(p)[0]).toBeCloseTo(0);
  });

  it('paints every light in its color', () => {
    allColored(make('Pulse', { color: BLUE }), BLUE);
  });
});

describe('ColorCycle', () => {
  it('starts every light at red', () => {
    allColored(make('ColorCycle'), RED);
  });

  it.each([
    [30, 4, GREEN],
    [-120, 1, BLUE],
    [120, 3, RED]
  ])('turns the hue at %d°/s', (speed, seconds, color) => {
    const p = make('ColorCycle', { speed });
    p.tick(seconds);
    allColored(p, color);
  });

  it('applies saturation and value', () => {
    allColored(make('ColorCycle', { saturation: 0, value: 0.5 }), {
      r: 128,
      g: 128,
      b: 128
    });
  });

  it('holds still without speed', () => {
    const p = make('ColorCycle', { speed: 0 });
    run(p, 3);
    allColored(p, RED);
  });
});

describe('Fire', () => {
  beforeEach(() => seedRandom());

  // Average of the red channel over a stretch of frames.
  function averageHeat(p: ReturnType<typeof make>, lights: number[], seconds = 3) {
    let total = 0;
    const frames = Math.round(seconds * 30);
    for (let f = 0; f < frames; f++) {
      p.tick(1 / 30);
      for (const i of lights) total += p.state[i].r + p.state[i].g + p.state[i].b;
    }
    return total / (frames * lights.length);
  }

  it('starts black and fully opaque', () => {
    const p = make('Fire');
    allColored(p, BLACK);
    expect(alphas(p).every((a) => a === 1)).toBe(true);
  });

  it('never ignites without sparking', () => {
    const p = make('Fire', { sparking: 0 });
    run(p, 3);
    allColored(p, BLACK);
  });

  it('mirrors both halves of the ring', () => {
    const p = make('Fire', { sparking: 1 });
    run(p, 2);
    for (let i = 0; i < N; i++) expect(rgbAt(p, i)).toEqual(rgbAt(p, N - 1 - i));
  });

  it('follows a black-red-yellow-white ramp', () => {
    const p = make('Fire', { sparking: 1, cooling: 20 });
    for (let f = 0; f < 90; f++) {
      p.tick(1 / 30);
      for (const { r, g, b } of p.state) {
        if (g > 0) expect(r).toBe(255);
        if (b > 0) expect(g).toBe(255);
      }
    }
  });

  it('burns hotter at the base than at the back', () => {
    const base = [0, 1, 2, 3, 4, N - 1, N - 2, N - 3, N - 4, N - 5];
    const mid = Math.floor(N / 2);
    const back = Array.from({ length: 10 }, (_, k) => mid - 5 + k);
    const p = make('Fire', { sparking: 1 });
    const lights = [...base, ...back];
    let baseHeat = 0;
    let backHeat = 0;
    for (let f = 0; f < 90; f++) {
      p.tick(1 / 30);
      for (const i of lights) {
        const heat = p.state[i].r + p.state[i].g + p.state[i].b;
        if (base.includes(i)) baseHeat += heat;
        else backHeat += heat;
      }
    }
    expect(baseHeat).toBeGreaterThan(backHeat);
  });

  it('burns lower with more cooling', () => {
    const all = Array.from({ length: N }, (_, i) => i);
    const mild = averageHeat(make('Fire', { sparking: 1, cooling: 20 }), all);
    seedRandom();
    const strong = averageHeat(make('Fire', { sparking: 1, cooling: 200 }), all);
    expect(mild).toBeGreaterThan(strong);
  });

  it('burns brighter with more sparking', () => {
    const all = Array.from({ length: N }, (_, i) => i);
    const low = averageHeat(make('Fire', { sparking: 0.1 }), all);
    seedRandom();
    const high = averageHeat(make('Fire', { sparking: 1 }), all);
    expect(high).toBeGreaterThan(low);
  });

  it('steps the simulation at a fixed rate, independent of frame time', () => {
    const p = make('Fire', { sparking: 1 });
    p.tick(1 / 60);
    allColored(p, BLACK);
    p.tick(1 / 60);
    expect(p.state.some((l) => l.r > 0)).toBe(true);
  });
});

describe('TheaterChase', () => {
  it.each([
    [1, 1],
    [0.3, 3],
    [0.25, 4],
    [0.1, 10],
    [0.02, 50],
    [0.001, N]
  ])('places dots for spacing %d', (spacing, count) => {
    expect(litLights(make('TheaterChase', { spacing }))).toHaveLength(count);
  });

  it.each([0.3, 0.1, 0.07, 0.02])('spreads dots evenly for spacing %d', (spacing) => {
    const dots = litLights(make('TheaterChase', { spacing }));
    const gaps = dots.map((d, k) => mod(dots[(k + 1) % dots.length] - d, N));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });

  it.each([
    [3.5 / N, 3],
    [-3.5 / N, -3]
  ])('rotates the dots at speed %d', (speed, shift) => {
    const p = make('TheaterChase', { spacing: 0.1, speed });
    const before = litLights(p);
    p.tick(1);
    expect(litLights(p)).toEqual(
      before.map((i) => mod(i + shift, N)).sort((a, b) => a - b)
    );
  });

  it('carries sub-light movement over between ticks', () => {
    const p = make('TheaterChase', { spacing: 0.1, speed: 0.4 / N });
    const before = litLights(p);
    p.tick(1);
    p.tick(1);
    expect(litLights(p)).toEqual(before);
    p.tick(1);
    expect(litLights(p)).toEqual(before.map((i) => mod(i + 1, N)));
  });

  it('lights dots fully in its color and leaves the rest dark', () => {
    const p = make('TheaterChase', { color: RED, spacing: 0.1 });
    for (const a of alphas(p)) expect([0, 1]).toContain(a);
    allColored(p, RED);
  });
});

describe('Aurora', () => {
  it('stays dark at zero intensity', () => {
    const p = make('Aurora', { intensity: 0 });
    run(p, 2);
    expect(litLights(p)).toEqual([]);
  });

  it('scales brightness with intensity', () => {
    const full = make('Aurora', { intensity: 1 });
    const half = make('Aurora', { intensity: 0.5 });
    full.tick(1.3);
    half.tick(1.3);
    alphas(half).forEach((a, i) => expect(a).toBeCloseTo(alphas(full)[i] / 2));
  });

  it('mixes only between its two colors', () => {
    const a = { r: 40, g: 200, b: 10 };
    const b = { r: 220, g: 30, b: 180 };
    const p = make('Aurora', { color: a, color2: b });
    run(p, 2);
    for (const light of p.state) {
      for (const ch of ['r', 'g', 'b'] as const) {
        expect(light[ch]).toBeGreaterThanOrEqual(Math.min(a[ch], b[ch]));
        expect(light[ch]).toBeLessThanOrEqual(Math.max(a[ch], b[ch]));
      }
    }
  });

  it('shows a single color when both colors match', () => {
    const p = make('Aurora', { color: GREEN, color2: GREEN });
    run(p, 1);
    allColored(p, GREEN);
  });

  it('drifts with speed and holds still without it', () => {
    const still = make('Aurora', { speed: 0 });
    const moving = make('Aurora', { speed: 0.1 });
    const stillBefore = snapshot(still);
    const movingBefore = snapshot(moving);
    run(still, 1);
    run(moving, 1);
    expect(still.state).toEqual(stillBefore);
    expect(moving.state).not.toEqual(movingBefore);
  });

  it('shows more curtains at a larger scale', () => {
    const few = localMaxima(alphas(make('Aurora', { scale: 1 }))).length;
    const many = localMaxima(alphas(make('Aurora', { scale: 6 }))).length;
    expect(many).toBeGreaterThan(few);
  });

  it('runs seamlessly across light 0', () => {
    const p = make('Aurora', { scale: 3 });
    run(p, 1.7);
    const a = alphas(p);
    const interior = Math.max(...a.slice(1).map((v, i) => Math.abs(v - a[i])));
    expect(Math.abs(a[0] - a[N - 1])).toBeLessThanOrEqual(interior * 1.5);
  });
});

describe('Ripple', () => {
  const center = Math.round(N / 2);

  it('drops a wave at the origin', () => {
    const p = make('Ripple', { origin: center / N });
    expect(argmax(alphas(p))).toBe(center);
    expect(alphas(p)[center]).toBeCloseTo(1);
  });

  it('expands outward in both directions at its speed', () => {
    const p = make('Ripple', { origin: center / N, speed: 0.1, decay: 0 });
    p.tick(1);
    const a = alphas(p);
    const radius = Math.round(0.1 * N);
    expect([center - radius, center + radius]).toContain(argmax(a));
    expect(a[center + radius]).toBeCloseTo(a[center - radius], 6);
    expect(a[center]).toBeLessThan(0.01);
  });

  it.each([0, 0.5, 1, 3])('fades waves at decay %d', (decay) => {
    const p = make('Ripple', { speed: 0.1, decay, interval: 100 });
    p.tick(1);
    expect(Math.max(...alphas(p))).toBeCloseTo(Math.exp(-decay), 2);
  });

  it('drops a new wave every interval', () => {
    const p = make('Ripple', { origin: center / N, speed: 0.1, decay: 0, interval: 0.5 });
    p.tick(0.25);
    expect(alphas(p)[center]).toBeLessThan(0.9);
    p.tick(0.25);
    expect(alphas(p)[center]).toBe(1);
  });

  it('draws wider fronts for a larger width', () => {
    const narrow = make('Ripple', { width: 0.02, speed: 0.1 });
    const wide = make('Ripple', { width: 0.1, speed: 0.1 });
    narrow.tick(1);
    wide.tick(1);
    expect(litLights(wide, 0.1).length).toBeGreaterThan(litLights(narrow, 0.1).length);
  });

  it('retires a wave once both halves meet', () => {
    const p = make('Ripple', { speed: 0.5, decay: 0, interval: 100 });
    run(p, 2);
    expect(litLights(p)).toEqual([]);
  });

  it('paints every light in its color', () => {
    allColored(make('Ripple', { color: BLUE }), BLUE);
  });
});

describe('Plasma', () => {
  it('shows a single hue with no hue range', () => {
    const p = make('Plasma', { hue: 120, hueRange: 0, saturation: 1 });
    run(p, 2);
    allColored(p, GREEN);
  });

  it('turns white without saturation', () => {
    allColored(make('Plasma', { saturation: 0 }), WHITE);
  });

  it('spans many colors with a wide hue range', () => {
    const p = make('Plasma', { hueRange: 360, saturation: 1 });
    const colors = new Set(p.state.map((l) => JSON.stringify([l.r, l.g, l.b])));
    expect(colors.size).toBeGreaterThan(30);
  });

  it('covers the lights fully', () => {
    const p = make('Plasma');
    run(p, 1);
    expect(alphas(p).every((a) => a === 1)).toBe(true);
  });

  it('drifts with speed and holds still without it', () => {
    const still = make('Plasma', { speed: 0 });
    const moving = make('Plasma', { speed: 0.2 });
    const stillBefore = snapshot(still);
    const movingBefore = snapshot(moving);
    run(still, 1);
    run(moving, 1);
    expect(still.state).toEqual(stillBefore);
    expect(moving.state).not.toEqual(movingBefore);
  });

  it('runs seamlessly across light 0', () => {
    const p = make('Plasma', { hueRange: 360 });
    run(p, 1.3);
    const red = p.state.map((l) => l.r);
    const interior = Math.max(...red.slice(1).map((v, i) => Math.abs(v - red[i])));
    expect(Math.abs(red[0] - red[N - 1])).toBeLessThanOrEqual(interior * 1.5);
  });
});

describe('Interference', () => {
  const lit = (p: ReturnType<typeof make>) => p.state.map((l) => l.r > 0 || l.b > 0);

  it.each([
    [1, 1],
    [3, 3],
    [4.4, 4],
    [2.6, 3],
    [7, 7]
  ])('draws %d waves as %d crests', (waves, crests) => {
    const p = make('Interference', { color: RED, color2: BLACK, waves, speed: 0 });
    expect(countRuns(lit(p))).toBe(crests);
  });

  it('moves a wave by half a wavelength in half a turn of phase', () => {
    const p = make('Interference', { color: RED, color2: BLACK, waves: 3, speed: 0.5 });
    const before = p.state.map((l) => l.r);
    p.tick(1);
    before.forEach((r, i) => {
      if (r > 2) expect(p.state[i].r, `light ${i}`).toBe(0);
    });
  });

  it('returns to the same picture after a full turn of phase', () => {
    const p = make('Interference', { color: RED, color2: BLACK, speed: 1, speed2: 2 });
    const before = p.state.map((l) => l.r);
    p.tick(1);
    p.state.forEach((l, i) => expect(Math.abs(l.r - before[i])).toBeLessThanOrEqual(1));
  });

  it('stacks overlapping crests into brighter nodes', () => {
    const shared = { waves: 3, waves2: 4, speed: 0, speed2: 0 };
    const tone = { r: 150, g: 0, b: 0 };
    const onlyA = make('Interference', { ...shared, color: tone, color2: BLACK });
    const onlyB = make('Interference', { ...shared, color: BLACK, color2: tone });
    const both = make('Interference', { ...shared, color: tone, color2: tone });
    for (let i = 0; i < N; i++) {
      const sum = Math.min(255, onlyA.state[i].r + onlyB.state[i].r);
      expect(Math.abs(both.state[i].r - sum), `light ${i}`).toBeLessThanOrEqual(1);
    }
  });

  it('holds still without speed', () => {
    const p = make('Interference', { speed: 0, speed2: 0 });
    const before = snapshot(p);
    run(p, 2);
    expect(p.state).toEqual(before);
  });
});

describe('Candle', () => {
  beforeEach(() => seedRandom());

  it('starts at full brightness', () => {
    for (const a of alphas(make('Candle', { brightness: 0.7 })))
      expect(a).toBeCloseTo(0.7);
  });

  it('holds steady without flicker depth', () => {
    const p = make('Candle', { brightness: 0.8, depth: 0 });
    run(p, 3);
    for (const a of alphas(p)) expect(a).toBeCloseTo(0.8);
  });

  it('stays dark at zero brightness', () => {
    const p = make('Candle', { brightness: 0 });
    run(p, 2);
    expect(litLights(p)).toEqual([]);
  });

  it.each([
    [1, 0.45],
    [0.6, 1],
    [0.5, 0.2]
  ])('flickers within range at brightness %d, depth %d', (brightness, depth) => {
    const p = make('Candle', { brightness, depth });
    for (let f = 0; f < 90; f++) {
      p.tick(1 / 30);
      for (const a of alphas(p)) {
        expect(a).toBeGreaterThanOrEqual(brightness * (1 - depth) - 1e-9);
        expect(a).toBeLessThanOrEqual(brightness + 1e-9);
      }
    }
    expect(new Set(alphas(p)).size).toBeGreaterThan(10);
  });

  it('flickers faster at a higher speed', () => {
    const change = (speed: number) => {
      seedRandom();
      const p = make('Candle', { speed });
      let total = 0;
      for (let f = 0; f < 90; f++) {
        const before = alphas(p);
        p.tick(1 / 30);
        alphas(p).forEach((a, i) => (total += Math.abs(a - before[i])));
      }
      return total;
    };
    expect(change(20)).toBeGreaterThan(change(1));
  });

  it('paints every light in its color', () => {
    allColored(make('Candle', { color: RED }), RED);
  });
});

describe('ColorTemperature', () => {
  const colorAt = (kelvin: number) => rgbAt(make('ColorTemperature', { kelvin }), 0);

  it('renders a warm bulb at 2700 K', () => {
    const { r, g, b } = colorAt(2700);
    expect(r).toBe(255);
    expect(g).toBeGreaterThan(b);
    expect(g).toBeLessThan(200);
  });

  it('renders near-white daylight at 6500 K', () => {
    const { r, g, b } = colorAt(6500);
    expect(r).toBe(255);
    expect(g).toBeGreaterThanOrEqual(250);
    expect(b).toBeGreaterThanOrEqual(245);
  });

  it('drops blue entirely at 1000 K', () => {
    expect(colorAt(1000)).toMatchObject({ r: 255, b: 0 });
  });

  it('turns blue at 12000 K', () => {
    const { r, b } = colorAt(12000);
    expect(b).toBe(255);
    expect(r).toBeLessThan(b);
  });

  it('cools monotonically as the temperature rises', () => {
    let previous = colorAt(1000);
    for (let kelvin = 1100; kelvin <= 12000; kelvin += 100) {
      const next = colorAt(kelvin);
      expect(next.r, `${kelvin} K`).toBeLessThanOrEqual(previous.r);
      expect(next.b, `${kelvin} K`).toBeGreaterThanOrEqual(previous.b);
      previous = next;
    }
  });

  it('dims the color rather than the alpha', () => {
    const full = colorAt(4000);
    const p = make('ColorTemperature', { kelvin: 4000, brightness: 0.5 });
    allColored(p, {
      r: Math.round(full.r * 0.5),
      g: Math.round(full.g * 0.5),
      b: Math.round(full.b * 0.5)
    });
    expect(alphas(p).every((a) => a === 1)).toBe(true);
  });

  it('holds still over time', () => {
    const p = make('ColorTemperature');
    const before = snapshot(p);
    run(p, 3);
    expect(p.state).toEqual(before);
  });
});

describe('Wipe', () => {
  const hard = { color: RED, color2: BLUE, blur: 0, speed: 0.25 };
  // The front is `speed * N` lights past the origin after one second.
  const front = 0.25 * N;

  const expectWiped = (p: ReturnType<typeof make>, painted: (i: number) => boolean) => {
    for (let i = 0; i < N; i++) {
      expect(rgbAt(p, i), `light ${i}`).toEqual(painted(i) ? BLUE : RED);
    }
  };

  it('starts out in color A', () => {
    allColored(make('Wipe', hard), RED);
  });

  it('sweeps color B forward from the origin', () => {
    const p = make('Wipe', hard);
    p.tick(1);
    expectWiped(p, (i) => i + 0.5 <= front);
  });

  it('sweeps backward', () => {
    const p = make('Wipe', { ...hard, direction: -1 });
    p.tick(1);
    expectWiped(p, (i) => mod(-i, N) + 0.5 <= front);
  });

  it('starts from the origin', () => {
    const p = make('Wipe', { ...hard, origin: 0.5 });
    p.tick(1);
    expectWiped(p, (i) => mod(i - 0.5 * N, N) + 0.5 <= front);
  });

  it('wipes color A back once the ring is covered', () => {
    const p = make('Wipe', hard);
    p.tick(4);
    allColored(p, BLUE);
    p.tick(1);
    expectWiped(p, (i) => i + 0.5 > front);
  });

  it('holds on color A between wipes', () => {
    const p = make('Wipe', { ...hard, hold: 2 });
    p.tick(4);
    p.tick(4);
    allColored(p, RED);
    p.tick(1);
    p.tick(1);
    allColored(p, RED);
    p.tick(1);
    expectWiped(p, (i) => i + 0.5 <= front);
  });

  it('blends the edge over the blur width', () => {
    const blended = (blur: number) => {
      const p = make('Wipe', { ...hard, blur });
      p.tick(1);
      return p.state.filter((l) => l.r !== 0 && l.r !== 255).length;
    };
    expect(blended(0)).toBe(0);
    expect(blended(0.1)).toBeGreaterThan(5);
    expect(blended(0.2)).toBeGreaterThan(blended(0.1));
  });

  it('always covers the lights fully', () => {
    const p = make('Wipe');
    run(p, 3);
    expect(alphas(p).every((a) => a === 1)).toBe(true);
  });
});

describe('Meteors', () => {
  const single = { rate: 1, variation: 0, speed: 0.1, tail: 0.08, colors: [GREEN] };

  // Launch exactly one meteor, then stop launching.
  function launchOne(overrides: Record<string, unknown> = {}) {
    const p = make('Meteors', { ...single, ...overrides });
    p.tick(1);
    p.update({ rate: 0 });
    return p;
  }

  beforeEach(() => seedRandom());

  it('stays dark at a zero rate', () => {
    const p = make('Meteors', { rate: 0 });
    run(p, 3);
    expect(litLights(p)).toEqual([]);
  });

  it('launches a meteor as a single bright head', () => {
    const p = launchOne();
    expect(litLights(p)).toHaveLength(1);
    expect(Math.max(...alphas(p))).toBe(1);
  });

  it.each([1, -1])('travels at its speed in direction %d, tail behind', (direction) => {
    const p = launchOne({ direction });
    const [start] = litLights(p);
    p.tick(1);
    const a = alphas(p);
    const head = argmax(a);
    expect([14, 15]).toContain(mod((head - start) * direction, N));
    expect(a[mod(head + direction, N)]).toBe(0);
    const tail = 0.08 * N;
    for (let d = 0; d <= tail; d++) {
      expect(a[mod(head - direction * d, N)]).toBeCloseTo(1 - d / tail);
    }
  });

  it('caps a meteor at the max speed', () => {
    const p = launchOne({ speed: 1, maxSpeed: 0.1 });
    const [start] = litLights(p);
    p.tick(1);
    expect([14, 15]).toContain(mod(argmax(alphas(p)) - start, N));
  });

  it('draws a longer tail for a larger tail setting', () => {
    const short = launchOne({ tail: 0.03 });
    seedRandom();
    const long = launchOne({ tail: 0.1 });
    short.tick(1);
    long.tick(1);
    expect(litLights(long).length).toBeGreaterThan(litLights(short).length);
  });

  it('retires a meteor after a full turn', () => {
    const p = launchOne({ speed: 0.5 });
    run(p, 3);
    expect(litLights(p)).toEqual([]);
  });

  it('colors meteors from the palette', () => {
    const p = make('Meteors', { rate: 20, colors: [RED, BLUE] });
    const seen = new Set<string>();
    for (let f = 0; f < 60; f++) {
      p.tick(1 / 30);
      for (const i of litLights(p)) {
        const color = rgbAt(p, i);
        expect([RED, BLUE]).toContainEqual(color);
        seen.add(JSON.stringify(color));
      }
    }
    expect(seen.size).toBe(2);
  });

  it('fills the sky more at a higher rate', () => {
    const coverage = (rate: number) => {
      seedRandom();
      const p = make('Meteors', { rate });
      let total = 0;
      for (let f = 0; f < 300; f++) {
        p.tick(1 / 30);
        total += litLights(p).length;
      }
      return total;
    };
    expect(coverage(5)).toBeGreaterThan(coverage(0.5) * 3);
  });
});

describe('Fireworks', () => {
  const center = Math.round(N / 2);

  // Launch one shell (from a fixed die roll: a quarter of the way through every range).
  function launchOne(overrides: Record<string, unknown> = {}) {
    fixRandom(0.25);
    const p = make('Fireworks', { rate: 1, origin: 0.5, ...overrides });
    p.tick(1);
    p.update({ rate: 0 });
    return p;
  }

  it('stays dark at a zero rate', () => {
    seedRandom();
    const p = make('Fireworks', { rate: 0 });
    run(p, 3);
    expect(litLights(p)).toEqual([]);
  });

  it('launches a shell from the launch point with a short trail', () => {
    const p = launchOne();
    const a = alphas(p);
    expect(a[center]).toBeCloseTo(1);
    expect(a[center - 1]).toBeCloseTo(2 / 3);
    expect(a[center - 2]).toBeCloseTo(1 / 3);
    expect(litLights(p)).toHaveLength(3);
  });

  it('launches from light 0 when the launch point is 0', () => {
    const p = launchOne({ origin: 0 });
    expect(argmax(alphas(p))).toBe(0);
  });

  it('bursts away from the launch point in the shell hue, then fades out', () => {
    const p = launchOne();
    run(p, 0.5, 1 / 60);
    const lit = litLights(p);
    expect(lit.length).toBeGreaterThan(0);
    expect(alphas(p)[center]).toBe(0);
    // A hue of 90° is yellow-green.
    for (const i of lit) {
      const { r, g, b } = rgbAt(p, i);
      expect(g).toBeGreaterThanOrEqual(r);
      expect(b).toBe(0);
    }
    run(p, 5);
    expect(litLights(p)).toEqual([]);
  });

  it('bursts in white without saturation', () => {
    const p = launchOne({ saturation: 0 });
    run(p, 0.5, 1 / 60);
    for (const i of litLights(p)) {
      const { r, g, b } = rgbAt(p, i);
      expect(g).toBe(r);
      expect(b).toBe(r);
    }
  });

  it('bursts wider with a larger spread', () => {
    const peak = (spread: number) => {
      const p = launchOne({ spread, decay: 0 });
      let most = 0;
      for (let f = 0; f < 120; f++) {
        p.tick(1 / 60);
        most = Math.max(most, litLights(p, 0.05).length);
      }
      return most;
    };
    expect(peak(0.3)).toBeGreaterThan(peak(0.05));
  });
});

describe('Rain', () => {
  const bottom = Math.round(N / 2);

  // Drop one drop (from a fixed die roll), then stop the rain.
  function dropOne(overrides: Record<string, unknown> = {}) {
    fixRandom(0.25);
    const p = make('Rain', { rate: 1, ...overrides });
    p.tick(1);
    p.update({ rate: 0 });
    return p;
  }

  it('stays dark at a zero rate', () => {
    seedRandom();
    const p = make('Rain', { rate: 0 });
    run(p, 3);
    expect(litLights(p)).toEqual([]);
  });

  it('starts a drop near the top with a trail behind it', () => {
    const p = dropOne();
    const a = alphas(p);
    const head = Math.round(0.025 * N);
    expect(a[head]).toBe(1);
    expect(a[head + 1]).toBe(0);
    expect(a[head - 1]).toBeGreaterThan(a[head - 2]);
  });

  it.each([
    [0.05, Math.floor(0.05 * N) + 1],
    [0.2, Math.floor(0.2 * N) + 1]
  ])('draws a trail of length %d', (length, lights) => {
    expect(litLights(dropOne({ length }))).toHaveLength(lights);
  });

  it('runs down one side and splashes at the bottom', () => {
    const p = dropOne({ splash: 0.8 });
    let bottomPeak = 0;
    for (let f = 0; f < 72; f++) {
      p.tick(1 / 60);
      for (const i of litLights(p)) {
        expect(i <= bottom + 1 || i >= N - 10, `light ${i}`).toBe(true);
      }
      bottomPeak = Math.max(bottomPeak, alphas(p)[bottom]);
    }
    expect(bottomPeak).toBeGreaterThan(0.5);
    run(p, 3);
    expect(litLights(p)).toEqual([]);
  });

  it.each([
    [0, false],
    [0.8, true]
  ])('flashes at the bottom with splash %d', (splash, flashes) => {
    const p = dropOne({ splash });
    run(p, 1.2);
    expect(alphas(p)[bottom] > 0).toBe(flashes);
    expect(litLights(p).every((i) => Math.abs(i - bottom) <= 1)).toBe(true);
  });

  it('paints every light in its color', () => {
    allColored(make('Rain', { color: GREEN }), GREEN);
  });
});

describe('Lightning', () => {
  // A die roll of 0.5: the first strike comes after ln 2 / rate seconds, covers
  // three quarters of `coverage` starting halfway round the ring, and flashes at 0.8.
  beforeEach(() => fixRandom(0.5));

  const arcStart = Math.floor(0.5 * N);
  const span = (coverage: number) => Math.max(1, Math.round(coverage * N * 0.75));

  it('stays dark until the first strike', () => {
    const p = make('Lightning', { rate: 1 });
    p.tick(0.5);
    expect(litLights(p)).toEqual([]);
    p.tick(0.2);
    expect(litLights(p).length).toBeGreaterThan(0);
  });

  it('strikes sooner at a higher rate', () => {
    const p = make('Lightning', { rate: 2 });
    p.tick(0.3);
    expect(litLights(p)).toEqual([]);
    p.tick(0.1);
    expect(litLights(p).length).toBeGreaterThan(0);
  });

  it.each([0.1, 0.4, 1])('lights an arc sized by coverage %d', (coverage) => {
    const p = make('Lightning', { rate: 1, coverage, softness: 0 });
    p.tick(0.7);
    const expected = Array.from({ length: span(coverage) }, (_, k) =>
      mod(arcStart + k, N)
    );
    expect(litLights(p)).toEqual(expected.sort((a, b) => a - b));
    for (const i of expected) expect(alphas(p)[i]).toBeCloseTo(0.8);
  });

  it('tapers the ends of the arc with softness', () => {
    const p = make('Lightning', { rate: 1, coverage: 0.4, softness: 0.5 });
    p.tick(0.7);
    const a = alphas(p);
    const middle = arcStart + Math.floor(span(0.4) / 2);
    expect(a[arcStart]).toBeGreaterThan(0);
    expect(a[arcStart]).toBeLessThan(a[arcStart + 5]);
    expect(a[middle]).toBeCloseTo(0.8);
  });

  it.each([2, 8, 20])('fades each flash at decay %d', (decay) => {
    const p = make('Lightning', { rate: 1, decay, softness: 0 });
    p.tick(0.7);
    p.tick(0.05);
    expect(alphas(p)[arcStart]).toBeCloseTo(0.8 * Math.exp(-decay * 0.05));
  });

  it.each([
    [1, false],
    [3, true]
  ])('fires a follow-up flash with up to %d flashes', (flashes, refires) => {
    const p = make('Lightning', { rate: 1, flashes, softness: 0 });
    p.tick(0.7);
    p.tick(0.05);
    p.tick(0.05);
    expect(Math.abs(alphas(p)[arcStart] - 0.8) < 1e-9).toBe(refires);
  });

  it('paints every light in its color', () => {
    allColored(make('Lightning', { color: BLUE }), BLUE);
  });
});
