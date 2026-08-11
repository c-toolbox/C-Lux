import { useState } from 'react';
import { Button, Group, NumberInput, Stack, TextInput } from '@mantine/core';

import type { PatternProps } from '../lib/api';

import { type CommonValues, type SubFormProps } from './types';

export interface FireFormValues extends CommonValues {
  type: 'Fire';
  cooling: number | string;
  sparking: number | string;
}

export const FIRE_DEFAULTS: FireFormValues = {
  type: 'Fire',
  name: '',
  cooling: 55,
  sparking: 0.6
};

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);

export function fireToProps(v: FireFormValues): PatternProps {
  return {
    name: v.name,
    cooling: num(v.cooling),
    sparking: num(v.sparking)
  };
}

export function FireForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<FireFormValues>) {
  const [values, setValues] = useState<FireFormValues>(initial);

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
          label={'Cooling'}
          min={0}
          step={5}
          value={values.cooling}
          onChange={(v) => setValues((prev) => ({ ...prev, cooling: v }))}
        />
        <NumberInput
          label={'Sparking'}
          min={0}
          max={1}
          step={0.05}
          value={values.sparking}
          onChange={(v) => setValues((prev) => ({ ...prev, sparking: v }))}
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
