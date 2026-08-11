import { useState } from 'react';
import { Button, ColorInput, Group, NumberInput, Stack, TextInput } from '@mantine/core';

import type { PatternProps } from '../lib/api';
import { hexToRgb } from '../lib/color';

import { type CommonValues, type SubFormProps } from './types';

export interface SparkleFormValues extends CommonValues {
  type: 'Sparkle';
  hex: string;
  density: number | string;
  decay: number | string;
}

export const SPARKLE_DEFAULTS: SparkleFormValues = {
  type: 'Sparkle',
  name: '',
  hex: '#ffffff',
  density: 0.14,
  decay: 3
};

export function sparkleToProps(v: SparkleFormValues): PatternProps {
  const density = typeof v.density === 'number' ? v.density : Number(v.density) || 0;
  const decay = typeof v.decay === 'number' ? v.decay : Number(v.decay) || 0;
  return { name: v.name, ...hexToRgb(v.hex), density, decay };
}

export function SparkleForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<SparkleFormValues>) {
  const [values, setValues] = useState<SparkleFormValues>(initial);

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
          label={'Density (ring/s)'}
          min={0}
          step={0.01}
          value={values.density}
          onChange={(v) => setValues((prev) => ({ ...prev, density: v }))}
        />
        <NumberInput
          label={'Decay'}
          min={0}
          step={0.5}
          value={values.decay}
          onChange={(v) => setValues((prev) => ({ ...prev, decay: v }))}
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
