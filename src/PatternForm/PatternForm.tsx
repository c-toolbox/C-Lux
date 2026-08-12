import { useState } from 'react';
import { NativeSelect, Stack } from '@mantine/core';

import {
  PATTERN_TYPES,
  type PatternParameters,
  type PatternProps,
  type PatternType
} from '../lib/api';
import { rgbToHex } from '../lib/color';

import {
  AURORA_DEFAULTS,
  AuroraForm,
  type AuroraFormValues,
  auroraToProps
} from './AuroraForm';
import {
  BOUNCE_DEFAULTS,
  BounceForm,
  type BounceFormValues,
  bounceToProps
} from './BounceForm';
import {
  COLOR_CYCLE_DEFAULTS,
  ColorCycleForm,
  type ColorCycleFormValues,
  colorCycleToProps
} from './ColorCycleForm';
import {
  COMET_DEFAULTS,
  CometForm,
  type CometFormValues,
  cometToProps
} from './CometForm';
import { FIRE_DEFAULTS, FireForm, type FireFormValues, fireToProps } from './FireForm';
import {
  GRADIENT_DEFAULTS,
  GradientForm,
  type GradientFormValues,
  gradientToProps
} from './GradientForm';
import {
  MOVING_GAUSSIAN_DEFAULTS,
  MovingGaussianForm,
  type MovingGaussianFormValues,
  movingGaussianToProps
} from './MovingGaussianForm';
import {
  PULSE_DEFAULTS,
  PulseForm,
  type PulseFormValues,
  pulseToProps
} from './PulseForm';
import {
  RAINBOW_DEFAULTS,
  RainbowForm,
  type RainbowFormValues,
  rainbowToProps
} from './RainbowForm';
import {
  RIPPLE_DEFAULTS,
  RippleForm,
  type RippleFormValues,
  rippleToProps
} from './RippleForm';
import {
  SINE_WAVE_DEFAULTS,
  SineWaveForm,
  type SineWaveFormValues,
  sineWaveToProps
} from './SineWaveForm';
import {
  SPARKLE_DEFAULTS,
  SparkleForm,
  type SparkleFormValues,
  sparkleToProps
} from './SparkleForm';
import {
  STATIC_DEFAULTS,
  type StaticFormValues,
  StaticPatternForm,
  staticToProps
} from './StaticPatternForm';
import {
  THEATER_CHASE_DEFAULTS,
  TheaterChaseForm,
  type TheaterChaseFormValues,
  theaterChaseToProps
} from './TheaterChaseForm';

export type FormValues =
  | StaticFormValues
  | MovingGaussianFormValues
  | SparkleFormValues
  | RainbowFormValues
  | SineWaveFormValues
  | CometFormValues
  | BounceFormValues
  | PulseFormValues
  | GradientFormValues
  | ColorCycleFormValues
  | FireFormValues
  | TheaterChaseFormValues
  | AuroraFormValues
  | RippleFormValues;

function defaultsFor(type: PatternType, name: string): FormValues {
  switch (type) {
    case 'StaticPattern':
      return { ...STATIC_DEFAULTS, name };
    case 'MovingGaussian':
      return { ...MOVING_GAUSSIAN_DEFAULTS, name };
    case 'Sparkle':
      return { ...SPARKLE_DEFAULTS, name };
    case 'Rainbow':
      return { ...RAINBOW_DEFAULTS, name };
    case 'SineWave':
      return { ...SINE_WAVE_DEFAULTS, name };
    case 'Comet':
      return { ...COMET_DEFAULTS, name };
    case 'Bounce':
      return { ...BOUNCE_DEFAULTS, name };
    case 'Pulse':
      return { ...PULSE_DEFAULTS, name };
    case 'Gradient':
      return { ...GRADIENT_DEFAULTS, name };
    case 'ColorCycle':
      return { ...COLOR_CYCLE_DEFAULTS, name };
    case 'Fire':
      return { ...FIRE_DEFAULTS, name };
    case 'TheaterChase':
      return { ...THEATER_CHASE_DEFAULTS, name };
    case 'Aurora':
      return { ...AURORA_DEFAULTS, name };
    case 'Ripple':
      return { ...RIPPLE_DEFAULTS, name };
    // skip default: exhaustive over PatternType
  }
}

export function toProps(values: FormValues): PatternProps {
  switch (values.type) {
    case 'StaticPattern':
      return staticToProps(values);
    case 'MovingGaussian':
      return movingGaussianToProps(values);
    case 'Sparkle':
      return sparkleToProps(values);
    case 'Rainbow':
      return rainbowToProps(values);
    case 'SineWave':
      return sineWaveToProps(values);
    case 'Comet':
      return cometToProps(values);
    case 'Bounce':
      return bounceToProps(values);
    case 'Pulse':
      return pulseToProps(values);
    case 'Gradient':
      return gradientToProps(values);
    case 'ColorCycle':
      return colorCycleToProps(values);
    case 'Fire':
      return fireToProps(values);
    case 'TheaterChase':
      return theaterChaseToProps(values);
    case 'Aurora':
      return auroraToProps(values);
    case 'Ripple':
      return rippleToProps(values);
    // skip default: exhaustive over FormValues
  }
}

export function fromParameters(p: PatternParameters): FormValues {
  switch (p.type) {
    case 'StaticPattern':
      return { type: 'StaticPattern', name: p.name, hex: rgbToHex(p.color) };
    case 'MovingGaussian':
      return {
        type: 'MovingGaussian',
        name: p.name,
        hex: rgbToHex(p.color),
        sigma: p.sigma,
        speed: p.speed,
        origin: p.origin
      };
    case 'Sparkle':
      return {
        type: 'Sparkle',
        name: p.name,
        hex: rgbToHex(p.color),
        density: p.density,
        decay: p.decay
      };
    case 'Rainbow':
      return {
        type: 'Rainbow',
        name: p.name,
        speed: p.speed,
        saturation: p.saturation,
        value: p.value,
        cycles: p.cycles
      };
    case 'SineWave':
      return {
        type: 'SineWave',
        name: p.name,
        hex: rgbToHex(p.color),
        wavelength: p.wavelength,
        speed: p.speed,
        min: p.min,
        max: p.max
      };
    case 'Comet':
      return {
        type: 'Comet',
        name: p.name,
        hex: rgbToHex(p.color),
        speed: p.speed,
        tail: p.tail,
        direction: p.direction,
        start: p.start,
        end: p.end
      };
    case 'Bounce':
      return {
        type: 'Bounce',
        name: p.name,
        hex: rgbToHex(p.color),
        sigma: p.sigma,
        speed: p.speed
      };
    case 'Pulse':
      return {
        type: 'Pulse',
        name: p.name,
        hex: rgbToHex(p.color),
        period: p.period,
        min: p.min,
        max: p.max
      };
    case 'Gradient':
      return {
        type: 'Gradient',
        name: p.name,
        hex: rgbToHex(p.color),
        hex2: rgbToHex(p.color2),
        speed: p.speed
      };
    case 'ColorCycle':
      return {
        type: 'ColorCycle',
        name: p.name,
        speed: p.speed,
        saturation: p.saturation,
        value: p.value
      };
    case 'Fire':
      return {
        type: 'Fire',
        name: p.name,
        cooling: p.cooling,
        sparking: p.sparking
      };
    case 'TheaterChase':
      return {
        type: 'TheaterChase',
        name: p.name,
        hex: rgbToHex(p.color),
        spacing: p.spacing,
        speed: p.speed
      };
    case 'Aurora':
      return {
        type: 'Aurora',
        name: p.name,
        hex: rgbToHex(p.color),
        hex2: rgbToHex(p.color2),
        speed: p.speed,
        scale: p.scale,
        intensity: p.intensity
      };
    case 'Ripple':
      return {
        type: 'Ripple',
        name: p.name,
        hex: rgbToHex(p.color),
        speed: p.speed,
        width: p.width,
        decay: p.decay,
        interval: p.interval,
        origin: p.origin
      };
    // skip default: exhaustive over PatternParameters
  }
}

interface PatternSubFormProps {
  mode: 'add' | 'edit';
  initial: FormValues;
  namePlaceholder: string;
  existingNames: string[];
  busy: boolean;
  onSubmit: (values: FormValues) => void;
}

// Renders exactly one concrete pattern form based on the value type.
export function PatternSubForm({ initial, ...rest }: PatternSubFormProps) {
  switch (initial.type) {
    case 'StaticPattern':
      return <StaticPatternForm initial={initial} {...rest} />;
    case 'MovingGaussian':
      return <MovingGaussianForm initial={initial} {...rest} />;
    case 'Sparkle':
      return <SparkleForm initial={initial} {...rest} />;
    case 'Rainbow':
      return <RainbowForm initial={initial} {...rest} />;
    case 'SineWave':
      return <SineWaveForm initial={initial} {...rest} />;
    case 'Comet':
      return <CometForm initial={initial} {...rest} />;
    case 'Bounce':
      return <BounceForm initial={initial} {...rest} />;
    case 'Pulse':
      return <PulseForm initial={initial} {...rest} />;
    case 'Gradient':
      return <GradientForm initial={initial} {...rest} />;
    case 'ColorCycle':
      return <ColorCycleForm initial={initial} {...rest} />;
    case 'Fire':
      return <FireForm initial={initial} {...rest} />;
    case 'TheaterChase':
      return <TheaterChaseForm initial={initial} {...rest} />;
    case 'Aurora':
      return <AuroraForm initial={initial} {...rest} />;
    case 'Ripple':
      return <RippleForm initial={initial} {...rest} />;
    // skip default: exhaustive over FormValues
  }
}

interface PatternFormProps {
  namePlaceholder: string;
  existingNames: string[];
  busy: boolean;
  onSubmit: (values: FormValues) => void;
}

// Add form: a type selector that swaps in the matching concrete sub form.
export function PatternForm({
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: PatternFormProps) {
  const [type, setType] = useState<PatternType>(PATTERN_TYPES[0]);

  return (
    <Stack gap={'md'}>
      <NativeSelect
        label={'Type'}
        value={type}
        data={PATTERN_TYPES.map((t) => ({ value: t, label: t }))}
        onChange={(e) => setType(e.currentTarget.value as PatternType)}
      />

      <PatternSubForm
        key={type}
        mode={'add'}
        initial={defaultsFor(type, namePlaceholder)}
        namePlaceholder={namePlaceholder}
        existingNames={existingNames}
        busy={busy}
        onSubmit={onSubmit}
      />
    </Stack>
  );
}
