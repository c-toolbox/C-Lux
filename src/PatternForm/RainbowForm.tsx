import { useState } from 'react';
import { Button, Group, NumberInput, Stack, TextInput } from '@mantine/core';

import type { PatternProps } from '../lib/api';

import { type CommonValues, type SubFormProps } from './types';

export interface RainbowFormValues extends CommonValues {
  type: 'Rainbow';
  speed: number | string;
  saturation: number | string;
  value: number | string;
  cycles: number | string;
}

export const RAINBOW_DEFAULTS: RainbowFormValues = {
  type: 'Rainbow',
  name: '',
  speed: 60,
  saturation: 1,
  value: 1,
  cycles: 1
};

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);

export function rainbowToProps(v: RainbowFormValues): PatternProps {
  return {
    name: v.name,
    speed: num(v.speed),
    saturation: num(v.saturation),
    value: num(v.value),
    cycles: num(v.cycles)
  };
}

export function RainbowForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<RainbowFormValues>) {
  const [values, setValues] = useState<RainbowFormValues>(initial);

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

      <Group grow>
        <NumberInput
          label={'Speed (°/s)'}
          step={5}
          value={values.speed}
          onChange={(v) => setValues((prev) => ({ ...prev, speed: v }))}
        />
        <NumberInput
          label={'Cycles'}
          min={0}
          step={1}
          value={values.cycles}
          onChange={(v) => setValues((prev) => ({ ...prev, cycles: v }))}
        />
      </Group>

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
