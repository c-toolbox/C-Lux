import { useState } from 'react';
import { Button, ColorInput, Group, NumberInput, Stack, TextInput } from '@mantine/core';

import type { PatternProps } from '../lib/api';
import { hexToRgb } from '../lib/color';

import { type CommonValues, type SubFormProps } from './types';

export interface TheaterChaseFormValues extends CommonValues {
  type: 'TheaterChase';
  hex: string;
  spacing: number | string;
  speed: number | string;
}

export const THEATER_CHASE_DEFAULTS: TheaterChaseFormValues = {
  type: 'TheaterChase',
  name: '',
  hex: '#ffffff',
  spacing: 3,
  speed: 8
};

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);

export function theaterChaseToProps(v: TheaterChaseFormValues): PatternProps {
  return {
    name: v.name,
    ...hexToRgb(v.hex),
    spacing: num(v.spacing),
    speed: num(v.speed)
  };
}

export function TheaterChaseForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<TheaterChaseFormValues>) {
  const [values, setValues] = useState<TheaterChaseFormValues>(initial);

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

      <Group grow>
        <NumberInput
          label={'Spacing'}
          min={1}
          step={1}
          value={values.spacing}
          onChange={(v) => setValues((prev) => ({ ...prev, spacing: v }))}
        />
        <NumberInput
          label={'Speed'}
          step={1}
          value={values.speed}
          onChange={(v) => setValues((prev) => ({ ...prev, speed: v }))}
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
