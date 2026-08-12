import { useState } from 'react';
import { Button, ColorInput, Group, NumberInput, Stack, TextInput } from '@mantine/core';

import type { PatternProps } from '../lib/api';
import { hexToRgb } from '../lib/color';

import { type CommonValues, type SubFormProps } from './types';

export interface RippleFormValues extends CommonValues {
  type: 'Ripple';
  hex: string;
  speed: number | string;
  width: number | string;
  decay: number | string;
  interval: number | string;
  origin: number | string;
}

export const RIPPLE_DEFAULTS: RippleFormValues = {
  type: 'Ripple',
  name: '',
  hex: '#4dabf7',
  speed: 0.25,
  width: 0.04,
  decay: 0.5,
  interval: 2,
  origin: 0.5
};

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);

export function rippleToProps(v: RippleFormValues): PatternProps {
  return {
    name: v.name,
    ...hexToRgb(v.hex),
    speed: num(v.speed),
    width: num(v.width),
    decay: num(v.decay),
    interval: num(v.interval),
    origin: num(v.origin)
  };
}

export function RippleForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<RippleFormValues>) {
  const [values, setValues] = useState<RippleFormValues>(initial);

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
          label={'Speed (turns/s)'}
          min={0}
          step={0.05}
          value={values.speed}
          onChange={(v) => setValues((prev) => ({ ...prev, speed: v }))}
        />
        <NumberInput
          label={'Width (ring share)'}
          min={0}
          max={1}
          step={0.01}
          value={values.width}
          onChange={(v) => setValues((prev) => ({ ...prev, width: v }))}
        />
      </Group>

      <Group grow>
        <NumberInput
          label={'Decay'}
          min={0}
          step={0.1}
          value={values.decay}
          onChange={(v) => setValues((prev) => ({ ...prev, decay: v }))}
        />
        <NumberInput
          label={'Interval (s)'}
          min={0}
          step={0.5}
          value={values.interval}
          onChange={(v) => setValues((prev) => ({ ...prev, interval: v }))}
        />
        <NumberInput
          label={'Origin'}
          min={0}
          max={1}
          step={0.05}
          value={values.origin}
          onChange={(v) => setValues((prev) => ({ ...prev, origin: v }))}
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
