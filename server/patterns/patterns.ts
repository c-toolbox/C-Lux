import { MovingGaussianPattern, type MovingGaussianProps } from './moving-gaussian.ts';
import { type Color, Pattern } from './pattern.ts';
import { StaticPattern, type StaticProps } from './static.ts';

// A concrete pattern class: constructable and tagged with a static `Type`
/* eslint-disable  @typescript-eslint/no-explicit-any */
export type PatternClass = (new (props: any) => Pattern) & { Type: string };

// The list of all available patterns. Register a new pattern by adding its class here
export const PATTERNS = [StaticPattern, MovingGaussianPattern] as const;

export type PatternType = (typeof PATTERNS)[number]['Type'];

export const PATTERN_TYPES = PATTERNS.map((p) => p.Type) as PatternType[];

// Look up a pattern class by its `Type` tag
export function patternByType(type: string): PatternClass | undefined {
  return PATTERNS.find((p) => p.Type === type);
}

export type { Color, MovingGaussianProps, StaticProps };
export type PatternProps = StaticProps | MovingGaussianProps;

// Union of every pattern's `parameters()` shape, derived from the registry.
export type PatternParameters = ReturnType<
  InstanceType<(typeof PATTERNS)[number]>['parameters']
>;
