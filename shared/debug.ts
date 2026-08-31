import type { Color } from './patterns/pattern.ts';

// The debug page's temporary overrides on the blended output, driven through the
// /api/debug endpoints. They live in memory only and are never saved to a scene.
export interface DebugStatus {
  // Blank the output without stopping the patterns, so the scene resumes where it left
  // off when this is switched back off.
  suspended: boolean;
  // Index of the single light to drive directly, or null when the scene is showing.
  // While set, every other light is dark.
  light: number | null;
  // The color that light is driven with.
  color: Color;
}

// A change to those overrides; omitted fields are left alone.
export interface DebugUpdate {
  suspended?: boolean;
  light?: number | null;
  color?: Color;
}
