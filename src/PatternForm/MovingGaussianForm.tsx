import { useState } from 'react';
import {
  Button,
  ColorInput,
  Group,
  NumberInput,
  Stack,
  TextInput
} from '@mantine/core';

import type { PatternProps } from '../lib/api';
import { hexToRgb } from '../lib/color';
import { type CommonValues, type SubFormProps } from './types';

export interface MovingGaussianFormValues extends CommonValues {
  type: 'MovingGaussian';
  sigma: number;
  speed: number | string;
}

export const MOVING_GAUSSIAN_DEFAULTS: MovingGaussianFormValues = {
  type: 'MovingGaussian',
  name: '',
  hex: '#4dabf7',
  sigma: 5,
  speed: 10
};

export function movingGaussianToProps(v: MovingGaussianFormValues): PatternProps {
  const speed = typeof v.speed === 'number' ? v.speed : Number(v.speed) || 0;
  return { name: v.name, ...hexToRgb(v.hex), sigma: v.sigma, speed };
}

export function MovingGaussianForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<MovingGaussianFormValues>) {
  const [values, setValues] = useState<MovingGaussianFormValues>(initial);

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

      <Group grow>
        <NumberInput
          label={'Sigma'}
          min={0}
          step={0.5}
          value={values.sigma}
          onChange={(v) =>
            setValues((prev) => ({
              ...prev,
              sigma: typeof v === 'number' ? v : 0
            }))
          }
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
