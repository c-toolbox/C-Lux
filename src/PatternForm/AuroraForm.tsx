import { useState } from 'react';
import { Button, ColorInput, Group, NumberInput, Stack, TextInput } from '@mantine/core';

import type { PatternProps } from '../lib/api';
import { hexToRgb } from '../lib/color';

import { type CommonValues, type SubFormProps } from './types';

export interface AuroraFormValues extends CommonValues {
  type: 'Aurora';
  hex: string;
  hex2: string;
  speed: number | string;
  scale: number | string;
  intensity: number | string;
}

export const AURORA_DEFAULTS: AuroraFormValues = {
  type: 'Aurora',
  name: '',
  hex: '#2bd47d',
  hex2: '#7048e8',
  speed: 0.05,
  scale: 2,
  intensity: 1
};

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);

export function auroraToProps(v: AuroraFormValues): PatternProps {
  return {
    name: v.name,
    ...hexToRgb(v.hex),
    color2: hexToRgb(v.hex2),
    speed: num(v.speed),
    scale: num(v.scale),
    intensity: num(v.intensity)
  };
}

export function AuroraForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<AuroraFormValues>) {
  const [values, setValues] = useState<AuroraFormValues>(initial);

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
        label={'Color A'}
        format={'hex'}
        value={values.hex}
        onChange={(hex) => setValues((v) => ({ ...v, hex }))}
      />

      <ColorInput
        label={'Color B'}
        format={'hex'}
        value={values.hex2}
        onChange={(hex2) => setValues((v) => ({ ...v, hex2 }))}
      />

      <Group grow>
        <NumberInput
          label={'Drift (turns/s)'}
          step={0.01}
          value={values.speed}
          onChange={(v) => setValues((prev) => ({ ...prev, speed: v }))}
        />
        <NumberInput
          label={'Curtains'}
          min={0}
          step={0.5}
          value={values.scale}
          onChange={(v) => setValues((prev) => ({ ...prev, scale: v }))}
        />
        <NumberInput
          label={'Intensity'}
          min={0}
          max={1}
          step={0.05}
          value={values.intensity}
          onChange={(v) => setValues((prev) => ({ ...prev, intensity: v }))}
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
