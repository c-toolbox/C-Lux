import { describe, expect, it } from 'vitest';

import { copyName } from '../../src/Editor/utils';
import { hexToRgb, rgbToHex } from '../../src/lib/color';

describe('rgbToHex', () => {
  it.each([
    [{ r: 255, g: 128, b: 0 }, '#ff8000ff'],
    [{ r: 255, g: 128, b: 0, a: 1 }, '#ff8000ff'],
    [{ r: 0, g: 0, b: 0, a: 0 }, '#00000000'],
    [{ r: 18, g: 52, b: 86, a: 0.5 }, '#12345680'],
    [{ r: 300, g: -5, b: 12.6, a: 2 }, '#ff000dff']
  ])('formats %o as %s', (color, hex) => {
    expect(rgbToHex(color)).toBe(hex);
  });
});

describe('hexToRgb', () => {
  it('reads a six-digit hex as opaque', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(hexToRgb('FF8000')).toEqual({ r: 255, g: 128, b: 0, a: 1 });
  });

  it('reads the alpha of an eight-digit hex', () => {
    expect(hexToRgb('#12345600')).toEqual({ r: 18, g: 52, b: 86, a: 0 });
    expect(hexToRgb(' #123456ff ')).toEqual({ r: 18, g: 52, b: 86, a: 1 });
    expect(hexToRgb('#12345680').a).toBeCloseTo(0.5, 2);
  });

  it.each(['', '#fff', '#1234567', '#123456789', 'red', '#gg0000'])(
    'falls back to opaque black for %s',
    (hex) => {
      expect(hexToRgb(hex)).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    }
  );

  it('round-trips through rgbToHex', () => {
    for (const a of [0, 0.2, 0.5, 1]) {
      const color = { r: 1, g: 2, b: 3, a: Math.round(a * 255) / 255 };
      expect(hexToRgb(rgbToHex(color))).toEqual(color);
    }
  });
});

describe('copyName', () => {
  it('appends " copy" to a free name', () => {
    expect(copyName('scene', ['scene'])).toBe('scene copy');
  });

  it('counts up past taken copies', () => {
    expect(copyName('scene', ['scene', 'scene copy'])).toBe('scene copy 2');
    expect(copyName('scene', ['scene', 'scene copy', 'scene copy 2'])).toBe(
      'scene copy 3'
    );
  });

  it('fills the first gap', () => {
    expect(copyName('scene', ['scene copy', 'scene copy 3'])).toBe('scene copy 2');
  });

  it('shortens a long name so the copy still fits the server limit', () => {
    const long = 'x'.repeat(60);
    const copy = copyName(long, [long]);
    expect(copy).toBe(`${'x'.repeat(55)} copy`);

    const second = copyName(long, [long, copy]);
    expect(second).toHaveLength(60);
    expect(second.endsWith(' copy 2')).toBe(true);
  });

  it('does not leave a double space when shortening at a space', () => {
    const name = `${'x'.repeat(54)} yyyyy`;
    expect(copyName(name, [])).toBe(`${'x'.repeat(54)} copy`);
  });
});
