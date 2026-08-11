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
  MOVING_GAUSSIAN_DEFAULTS,
  MovingGaussianForm,
  type MovingGaussianFormValues,
  movingGaussianToProps
} from './MovingGaussianForm';
import {
  STATIC_DEFAULTS,
  StaticPatternForm,
  type StaticFormValues,
  staticToProps
} from './StaticPatternForm';

export type FormValues = StaticFormValues | MovingGaussianFormValues;

function defaultsFor(type: PatternType, name: string): FormValues {
  switch (type) {
    case 'StaticPattern':
      return { ...STATIC_DEFAULTS, name };
    case 'MovingGaussian':
      return { ...MOVING_GAUSSIAN_DEFAULTS, name };
  }
}

export function toProps(values: FormValues): PatternProps {
  switch (values.type) {
    case 'StaticPattern':
      return staticToProps(values);
    case 'MovingGaussian':
      return movingGaussianToProps(values);
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
