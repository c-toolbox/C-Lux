import { BouncePattern, type BounceProps } from './bounce.ts';
import { ColorCyclePattern, type ColorCycleProps } from './color-cycle.ts';
import { CometPattern, type CometProps } from './comet.ts';
import { FirePattern, type FireProps } from './fire.ts';
import { GradientPattern, type GradientProps } from './gradient.ts';
import { MovingGaussianPattern, type MovingGaussianProps } from './moving-gaussian.ts';
import { type Color, Pattern } from './pattern.ts';
import { PulsePattern, type PulseProps } from './pulse.ts';
import { RainbowPattern, type RainbowProps } from './rainbow.ts';
import { SineWavePattern, type SineWaveProps } from './sine-wave.ts';
import { SparklePattern, type SparkleProps } from './sparkle.ts';
import { StaticPattern, type StaticProps } from './static.ts';
import { TheaterChasePattern, type TheaterChaseProps } from './theater-chase.ts';

// A concrete pattern class: constructable and tagged with a static `Type` and a
// user-facing `DisplayName`.
/* eslint-disable  @typescript-eslint/no-explicit-any */
export type PatternClass = (new (props: any) => Pattern) & {
  Type: string;
  DisplayName: string;
};

// The list of all available patterns. Register a new pattern by adding its class here
export const PATTERNS = [
  StaticPattern,
  MovingGaussianPattern,
  SparklePattern,
  RainbowPattern,
  SineWavePattern,
  CometPattern,
  BouncePattern,
  PulsePattern,
  GradientPattern,
  ColorCyclePattern,
  FirePattern,
  TheaterChasePattern
] as const;

export type PatternType = (typeof PATTERNS)[number]['Type'];

export const PATTERN_TYPES = PATTERNS.map((p) => p.Type) as PatternType[];

// Look up a pattern class by its `Type` tag
export function patternByType(type: string): PatternClass | undefined {
  return PATTERNS.find((p) => p.Type === type);
}

// The user-facing name for a pattern `Type`, falling back to the raw type.
export function patternDisplayName(type: string): string {
  return patternByType(type)?.DisplayName ?? type;
}

export type {
  BounceProps,
  Color,
  ColorCycleProps,
  CometProps,
  FireProps,
  GradientProps,
  MovingGaussianProps,
  PulseProps,
  RainbowProps,
  SineWaveProps,
  SparkleProps,
  StaticProps,
  TheaterChaseProps
};
export type PatternProps =
  | StaticProps
  | MovingGaussianProps
  | SparkleProps
  | RainbowProps
  | SineWaveProps
  | CometProps
  | BounceProps
  | PulseProps
  | GradientProps
  | ColorCycleProps
  | FireProps
  | TheaterChaseProps;

// Union of every pattern's `parameters()` shape, derived from the registry.
export type PatternParameters = ReturnType<
  InstanceType<(typeof PATTERNS)[number]>['parameters']
>;

// A named snapshot of a full pattern list, storable in the library.
export interface StoredPatternSet {
  name: string;
  patterns: PatternParameters[];
}
