import { useState } from 'react';
import {
  Button,
  ColorInput,
  Group,
  NativeSelect,
  NumberInput,
  Stack,
  Text,
  TextInput
} from '@mantine/core';

import config from '../../config.json';
import type { PatternProps } from '../lib/api';
import { hexToRgb } from '../lib/color';

import { type CommonValues, type SubFormProps } from './types';

const LAST_LIGHT = config.nLights - 1;

export interface CometFormValues extends CommonValues {
  type: 'Comet';
  hex: string;
  speed: number | string;
  tail: number | string;
  direction: number;
  start: number | string;
  end: number | string;
}

export const COMET_DEFAULTS: CometFormValues = {
  type: 'Comet',
  name: '',
  hex: '#ffffff',
  speed: 15,
  tail: 8,
  direction: 1,
  start: 0,
  end: 0
};

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);

export function cometToProps(v: CometFormValues): PatternProps {
  return {
    name: v.name,
    ...hexToRgb(v.hex),
    speed: num(v.speed),
    tail: num(v.tail),
    direction: v.direction,
    start: num(v.start),
    end: num(v.end)
  };
}

export function CometForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: SubFormProps<CometFormValues>) {
  const [values, setValues] = useState<CometFormValues>(initial);

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
          label={'Speed'}
          step={1}
          value={values.speed}
          onChange={(v) => setValues((prev) => ({ ...prev, speed: v }))}
        />
        <NumberInput
          label={'Tail'}
          min={0}
          step={1}
          value={values.tail}
          onChange={(v) => setValues((prev) => ({ ...prev, tail: v }))}
        />
      </Group>

      <NativeSelect
        label={'Direction'}
        value={String(values.direction)}
        data={[
          { value: '1', label: 'Forward' },
          { value: '-1', label: 'Backward' }
        ]}
        onChange={(e) =>
          setValues((prev) => ({ ...prev, direction: Number(e.currentTarget.value) }))
        }
      />

      <Stack gap={4}>
        <Group grow>
          <NumberInput
            label={'Start'}
            min={0}
            max={LAST_LIGHT}
            step={1}
            value={values.start}
            onChange={(v) => setValues((prev) => ({ ...prev, start: v }))}
          />
          <NumberInput
            label={'End'}
            min={0}
            max={LAST_LIGHT}
            step={1}
            value={values.end}
            onChange={(v) => setValues((prev) => ({ ...prev, end: v }))}
          />
        </Group>
        <Text size={'xs'} c={'dimmed'}>
          Same start and end loops the whole ring.
        </Text>
      </Stack>

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
