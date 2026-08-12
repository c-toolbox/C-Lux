import { AuroraPattern, type AuroraProps } from './aurora.ts';
import { BouncePattern, type BounceProps } from './bounce.ts';
import { ColorCyclePattern, type ColorCycleProps } from './color-cycle.ts';
import { CometPattern, type CometProps } from './comet.ts';
import { FirePattern, type FireProps } from './fire.ts';
import { GradientPattern, type GradientProps } from './gradient.ts';
import { MovingGaussianPattern, type MovingGaussianProps } from './moving-gaussian.ts';
import { type Color, type FieldSpec, Pattern, type PatternSchema } from './pattern.ts';
import { PulsePattern, type PulseProps } from './pulse.ts';
import { RainbowPattern, type RainbowProps } from './rainbow.ts';
import { RipplePattern, type RippleProps } from './ripple.ts';
import { SineWavePattern, type SineWaveProps } from './sine-wave.ts';
import { SparklePattern, type SparkleProps } from './sparkle.ts';
import { StaticPattern, type StaticProps } from './static.ts';
import { TheaterChasePattern, type TheaterChaseProps } from './theater-chase.ts';

// The static metadata every pattern class carries: its `Type` tag, a user-facing
// `DisplayName` and the `Fields` describing its configurable parameters.
export interface PatternStatics {
  Type: string;
  DisplayName: string;
  Fields: PatternSchema;
}

// A concrete pattern class: constructable and tagged with the static metadata above.
export type PatternClass = (new (props: PatternProps) => Pattern) & PatternStatics;

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
  TheaterChasePattern,
  AuroraPattern,
  RipplePattern
] as const satisfies readonly PatternStatics[];

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
  AuroraProps,
  BounceProps,
  Color,
  ColorCycleProps,
  CometProps,
  FieldSpec,
  FireProps,
  GradientProps,
  MovingGaussianProps,
  PatternSchema,
  PulseProps,
  RainbowProps,
  RippleProps,
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
  | TheaterChaseProps
  | AuroraProps
  | RippleProps;

// Union of every pattern's `parameters()` shape, derived from the registry.
export type PatternParameters = ReturnType<
  InstanceType<(typeof PATTERNS)[number]>['parameters']
>;

// A named snapshot of a full pattern list, storable in the library.
export interface StoredPatternSet {
  name: string;
  patterns: PatternParameters[];
}
