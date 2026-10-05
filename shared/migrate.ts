import { AudioPattern } from './patterns/audio.ts';
import { MovingGaussianPattern } from './patterns/moving-gaussian.ts';
import { SparklePattern } from './patterns/sparkle.ts';

type RawPattern = Record<string, unknown>;

// Step `i` upgrades a saved pattern from version `i + 1` to `i + 2`. Patterns are
// untrusted here, so anything unexpected passes through for validation to reject.
const STEPS: ReadonlyArray<(pattern: RawPattern) => RawPattern> = [
  // 1 -> 2: Sparkle's hue window is centered on `hue` rather than starting at it,
  // Moving Gaussian's speed runs the same way as every other pattern's, and fields added
  // since get their defaults, which render as before.
  (p) => {
    if (p.type === AudioPattern.Type) {
      const { hz, color } = AudioPattern.Fields;
      return { hz: hz.default, color: { ...color.default }, ...p };
    }
    if (p.type === MovingGaussianPattern.Type) {
      // `0 - speed` rather than `-speed`, so a still pattern doesn't become -0.
      return typeof p.speed === 'number' ? { ...p, speed: 0 - p.speed } : p;
    }
    if (p.type !== SparklePattern.Type) return p;
    if (typeof p.hue !== 'number' || typeof p.hueRange !== 'number') return p;
    const { attack } = SparklePattern.Fields;
    return { attack: attack.default, ...p, hue: (p.hue + p.hueRange / 2) % 360 };
  }
];

// Version of the saved pattern data, stamped on scenes.json and exported scene files.
export const PATTERN_DATA_VERSION = STEPS.length + 1;

// Convert saved patterns from `fromVersion` up to `PATTERN_DATA_VERSION`.
export function migratePatterns(patterns: unknown[], fromVersion: number): unknown[] {
  return patterns.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry;
    let pattern = entry as RawPattern;
    for (let v = fromVersion; v < PATTERN_DATA_VERSION; v++) {
      pattern = STEPS[v - 1](pattern);
    }
    return pattern;
  });
}
