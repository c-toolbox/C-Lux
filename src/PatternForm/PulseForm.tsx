import { useState } from 'react';
import { Button, ColorInput, Group, NumberInput, Stack, TextInput } from '@mantine/core';

import type { PatternProps } from '../lib/api';
import { hexToRgb } from '../lib/color';

import { type CommonValues, type SubFormProps } from './types';

export interface PulseFormValues extends CommonValues {
  type: 'Pulse';
  hex: string;
  period: number | string;
  min: number | string;
  max: number | string;
}

export const PULSE_DEFAULTS: PulseFormValues = {
  type: 'Pulse',
  name: '',
  hex: '#4dabf7',
  period: 3,
  min: 0,
  max: 1
};

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);

export function pulseToProps(v: PulseFormValues): PatternProps {
  return {
    name: v.name,
    ...hexToRgb(v.hex),
    period: num(v.period),
    min: num(v.min),
    max: num(v.max)
  };
}

export function PulseForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<PulseFormValues>) {
  const [values, setValues] = useState<PulseFormValues>(initial);

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
        label={'Color'}
        format={'hex'}
        value={values.hex}
        onChange={(hex) => setValues((v) => ({ ...v, hex }))}
      />

      <NumberInput
        label={'Period (s)'}
        min={0}
        step={0.5}
        value={values.period}
        onChange={(v) => setValues((prev) => ({ ...prev, period: v }))}
      />

      <Group grow>
        <NumberInput
          label={'Min'}
          min={0}
          max={1}
          step={0.05}
          value={values.min}
          onChange={(v) => setValues((prev) => ({ ...prev, min: v }))}
        />
        <NumberInput
          label={'Max'}
          min={0}
          max={1}
          step={0.05}
          value={values.max}
          onChange={(v) => setValues((prev) => ({ ...prev, max: v }))}
        />
      </Group>

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
