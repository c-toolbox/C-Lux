import type { Color, PatternParameters } from '../lib/api';

export function rgbToHex({ r, g, b }: Color): string {
  const clamp8 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const hex = (n: number) => clamp8(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// A representative swatch color for a pattern, falling back for patterns
// that have no single configurable color (e.g. Rainbow, Color Cycle, Fire).
export function patternSwatchHex(p: PatternParameters): string {
  if ('color' in p) return rgbToHex(p.color);
  if (p.type === 'Fire') return '#ff6600';
  return '#9e9e9e';
}

export function hexToRgb(hex: string): Color {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}
