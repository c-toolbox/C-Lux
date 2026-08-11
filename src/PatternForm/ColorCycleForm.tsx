import { useState } from 'react';
import { Button, Group, NumberInput, Stack, TextInput } from '@mantine/core';

import type { PatternProps } from '../lib/api';

import { type CommonValues, type SubFormProps } from './types';

export interface ColorCycleFormValues extends CommonValues {
  type: 'ColorCycle';
  speed: number | string;
  saturation: number | string;
  value: number | string;
}

export const COLOR_CYCLE_DEFAULTS: ColorCycleFormValues = {
  type: 'ColorCycle',
  name: '',
  speed: 30,
  saturation: 1,
  value: 1
};

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);

export function colorCycleToProps(v: ColorCycleFormValues): PatternProps {
  return {
    name: v.name,
    speed: num(v.speed),
    saturation: num(v.saturation),
    value: num(v.value)
  };
}

export function ColorCycleForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<ColorCycleFormValues>) {
  const [values, setValues] = useState<ColorCycleFormValues>(initial);

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

      <NumberInput
        label={'Speed (°/s)'}
        step={5}
        value={values.speed}
        onChange={(v) => setValues((prev) => ({ ...prev, speed: v }))}
      />

      <Group grow>
        <NumberInput
          label={'Saturation'}
          min={0}
          max={1}
          step={0.05}
          value={values.saturation}
          onChange={(v) => setValues((prev) => ({ ...prev, saturation: v }))}
        />
        <NumberInput
          label={'Value'}
          min={0}
          max={1}
          step={0.05}
          value={values.value}
          onChange={(v) => setValues((prev) => ({ ...prev, value: v }))}
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
