import { useState } from 'react';
import { Button, ColorInput, Group, NumberInput, Stack, TextInput } from '@mantine/core';

import type { PatternProps } from '../lib/api';
import { hexToRgb } from '../lib/color';

import { type CommonValues, type SubFormProps } from './types';

export interface SineWaveFormValues extends CommonValues {
  type: 'SineWave';
  hex: string;
  wavelength: number | string;
  speed: number | string;
  min: number | string;
  max: number | string;
}

export const SINE_WAVE_DEFAULTS: SineWaveFormValues = {
  type: 'SineWave',
  name: '',
  hex: '#4dabf7',
  wavelength: 20,
  speed: 10,
  min: 0,
  max: 1
};

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);

export function sineWaveToProps(v: SineWaveFormValues): PatternProps {
  return {
    name: v.name,
    ...hexToRgb(v.hex),
    wavelength: num(v.wavelength),
    speed: num(v.speed),
    min: num(v.min),
    max: num(v.max)
  };
}

export function SineWaveForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<SineWaveFormValues>) {
  const [values, setValues] = useState<SineWaveFormValues>(initial);

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
          label={'Wavelength'}
          min={1}
          step={1}
          value={values.wavelength}
          onChange={(v) => setValues((prev) => ({ ...prev, wavelength: v }))}
        />
        <NumberInput
          label={'Speed'}
          step={1}
          value={values.speed}
          onChange={(v) => setValues((prev) => ({ ...prev, speed: v }))}
        />
      </Group>

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
