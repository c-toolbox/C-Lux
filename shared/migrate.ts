import { AudioPattern } from './patterns/audio.ts';
import { MovingGaussianPattern } from './patterns/moving-gaussian.ts';
import { SparklePattern } from './patterns/sparkle.ts';
import { VideoPattern } from './patterns/video.ts';

type RawPattern = Record<string, unknown>;

// Step `i` upgrades a saved pattern from version `i + 1` to `i + 2`. Patterns are
// untrusted here, so anything unexpected passes through for validation to reject.
const STEPS: ReadonlyArray<(pattern: RawPattern) => RawPattern> = [
  // 1 -> 2: Sparkle's hue window is centered on `hue` rather than starting at it,
  // Moving Gaussian's speed runs the same way as every other pattern's, and fields added
  // since get their defaults, which render as before. The Audio and Video capture
  // settings used to live in the capture panel, which started on these same defaults.
  (p) => {
    if (p.type === AudioPattern.Type) {
      const { input, hz, color, colorMode, frontColor, backColor, colorMap } =
        AudioPattern.Fields;
      return {
        input: input.default,
        hz: hz.default,
        color: { ...color.default },
        colorMode: colorMode.default,
        frontColor: { ...frontColor.default },
        backColor: { ...backColor.default },
        colorMap: colorMap.default.map((stop) => ({ ...stop })),
        ...p
      };
    }
    if (p.type === MovingGaussianPattern.Type) {
      // `0 - speed` rather than `-speed`, so a still pattern doesn't become -0.
      return typeof p.speed === 'number' ? { ...p, speed: 0 - p.speed } : p;
    }
    if (p.type === VideoPattern.Type) {
      const f = VideoPattern.Fields;
      return {
        input: f.input.default,
        ndiSource: f.ndiSource.default,
        sampling: f.sampling.default,
        centerX: f.centerX.default,
        centerY: f.centerY.default,
        radius: f.radius.default,
        ringWidth: f.ringWidth.default,
        rotation: f.rotation.default,
        stripY: f.stripY.default,
        stripHeight: f.stripHeight.default,
        ...p
      };
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
