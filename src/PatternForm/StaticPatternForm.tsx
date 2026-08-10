import { useState } from 'react';
import { Button, ColorInput, Stack, TextInput } from '@mantine/core';

import type { PatternProps } from '../lib/api';
import { hexToRgb } from '../lib/color';
import { type CommonValues, type SubFormProps } from './types';

export interface StaticFormValues extends CommonValues {
  type: 'StaticPattern';
}

export const STATIC_DEFAULTS: StaticFormValues = {
  type: 'StaticPattern',
  name: '',
  hex: '#4dabf7'
};

export function staticToProps(v: StaticFormValues): PatternProps {
  return { name: v.name, ...hexToRgb(v.hex) };
}

export function StaticPatternForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<StaticFormValues>) {
  const [values, setValues] = useState<StaticFormValues>(initial);

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
        onChange={(e) =>
          setValues((v) => ({ ...v, name: e.currentTarget.value }))
        }
      />

      <ColorInput
        label={'Color'}
        format={'hex'}
        value={values.hex}
        onChange={(hex) => setValues((v) => ({ ...v, hex }))}
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
