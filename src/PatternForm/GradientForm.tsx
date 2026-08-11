import { useState } from 'react';
import { Button, ColorInput, NumberInput, Stack, TextInput } from '@mantine/core';

import type { PatternProps } from '../lib/api';
import { hexToRgb } from '../lib/color';

import { type CommonValues, type SubFormProps } from './types';

export interface GradientFormValues extends CommonValues {
  type: 'Gradient';
  hex: string;
  hex2: string;
  speed: number | string;
}

export const GRADIENT_DEFAULTS: GradientFormValues = {
  type: 'Gradient',
  name: '',
  hex: '#4dabf7',
  hex2: '#f74d4d',
  speed: 0.1
};

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);

export function gradientToProps(v: GradientFormValues): PatternProps {
  return {
    name: v.name,
    ...hexToRgb(v.hex),
    color2: hexToRgb(v.hex2),
    speed: num(v.speed)
  };
}

export function GradientForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<GradientFormValues>) {
  const [values, setValues] = useState<GradientFormValues>(initial);

  const nameTaken = mode === 'add' && existingNames.includes(values.name.trim());
  const nameError =
    values.name.trim() === ''
      ? 'Name is required'
      : nameTaken
        ? 'A pattern with this name already exists'
        : null;

  return (
    <Stack gap={'md'}>
      <TextInput
        label={'Name'}
        placeholder={namePlaceholder}
        value={values.name}
        error={nameError}
        disabled={mode === 'edit'}
        onChange={(e) => setValues((v) => ({ ...v, name: e.currentTarget.value }))}
      />

      <ColorInput
        label={'Color A'}
        format={'hex'}
        value={values.hex}
        onChange={(hex) => setValues((v) => ({ ...v, hex }))}
      />

      <ColorInput
        label={'Color B'}
        format={'hex'}
        value={values.hex2}
        onChange={(hex2) => setValues((v) => ({ ...v, hex2 }))}
      />

      <NumberInput
        label={'Drift (cycles/s)'}
        step={0.05}
        value={values.speed}
        onChange={(v) => setValues((prev) => ({ ...prev, speed: v }))}
      />

      <Button
        onClick={() => onSubmit(values)}
        loading={busy}
        disabled={nameError !== null}
      >
        {mode === 'add' ? 'Add pattern' : 'Save changes'}
      </Button>
    </Stack>
  );
}
