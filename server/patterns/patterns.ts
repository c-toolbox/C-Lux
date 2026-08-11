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
// user-facing `DisplayName`. Constructor signatures are bivariant, so every concrete
// pattern (each taking its own `*Props`) is assignable to this shared type.
export type PatternClass = (new (props: PatternProps) => Pattern) & {
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

export const PATTERN_TYPES = PATTERNS.map((p) => p.Type);

// Look up a pattern class by its `Type` tag
export function patternByType(type: string): PatternClass | undefined {
  // The registry mixes classes with different `*Props` constructors; narrowing back to
  // the shared `PatternClass` requires a double assertion, which the type-aware linter
  // can't verify is non-trivial here.

  return PATTERNS.find((p) => p.Type === type) as unknown as PatternClass | undefined;
}

// Reconstruct a concrete pattern instance from its serialized `parameters()` shape,
// the inverse of calling `pattern.parameters()`.
export function patternFromParameters(params: PatternParameters): Pattern | undefined {
  const cls = patternByType(params.type);
  if (!cls) return undefined;
  return new cls(Pattern.propsFromParameters(params) as PatternProps);
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
