import type { Color } from '../lib/api';

// Colors travel through the pickers as 8-digit `#rrggbbaa` hex, the alpha included.
export function rgbToHex({ r, g, b, a = 1 }: Color): string {
  const clamp8 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const hex = (n: number) => clamp8(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${hex(a * 255)}`;
}

export function hexToRgb(hex: string): Color {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0, a: 1 };
  const int = parseInt(m[1], 16);
  const a = m[2] === undefined ? 1 : parseInt(m[2], 16) / 255;
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255, a };
}
