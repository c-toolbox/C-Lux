import { useState } from 'react';
import {
  Button,
  ColorInput,
  Group,
  NativeSelect,
  NumberInput,
  Stack,
  TextInput
} from '@mantine/core';

import {
  type Color,
  type FieldSpec,
  PATTERN_TYPES,
  patternByType,
  patternDisplayName,
  type PatternParameters,
  type PatternProps,
  type PatternSchema,
  type PatternType
} from '../lib/api';
import { hexToRgb, rgbToHex } from '../lib/color';

export interface FormValues {
  type: PatternType;
  name: string;
  // Keyed by the pattern's schema fields: hex strings for colors, numbers otherwise.
  values: Record<string, number | string>;
}

function schemaFor(type: PatternType): PatternSchema {
  return patternByType(type)?.Fields ?? {};
}

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);

function defaultsFor(type: PatternType, name: string): FormValues {
  const values: Record<string, number | string> = {};
  for (const [key, spec] of Object.entries(schemaFor(type))) {
    values[key] = spec.kind === 'color' ? rgbToHex(spec.default) : spec.default;
  }
  return { type, name, values };
}

export function toProps(values: FormValues): PatternProps {
  const props: Record<string, unknown> = { name: values.name };
  for (const [key, spec] of Object.entries(schemaFor(values.type))) {
    const value = values.values[key];
    if (spec.kind !== 'color') {
      props[key] = num(value);
    } else if (key === 'color') {
      // The primary color is flattened into r/g/b, the shape pattern constructors take.
      Object.assign(props, hexToRgb(String(value)));
    } else {
      props[key] = hexToRgb(String(value));
    }
  }
  return props as unknown as PatternProps;
}

export function fromParameters(p: PatternParameters): FormValues {
  const stored = p as unknown as Record<string, unknown>;
  const values: Record<string, number | string> = {};
  for (const [key, spec] of Object.entries(schemaFor(p.type))) {
    const value = stored[key];
    if (spec.kind === 'color') {
      values[key] = rgbToHex((value ?? spec.default) as Color);
    } else {
      values[key] = typeof value === 'number' ? value : spec.default;
    }
  }
  return { type: p.type, name: p.name, values };
}

type Entry = [string, FieldSpec];

// Group consecutive fields that share a row number so they render side by side.
function rows(schema: PatternSchema): Entry[][] {
  const grouped: Entry[][] = [];
  for (const entry of Object.entries(schema)) {
    const previous = grouped[grouped.length - 1];
    if (entry[1].row !== undefined && previous?.[0][1].row === entry[1].row) {
      previous.push(entry);
    } else {
      grouped.push([entry]);
    }
  }
  return grouped;
}

interface FieldProps {
  spec: FieldSpec;
  value: number | string;
  onChange: (value: number | string) => void;
}

function Field({ spec, value, onChange }: FieldProps) {
  if (spec.kind === 'color') {
    return (
      <ColorInput
        label={spec.label}
        description={spec.hint}
        format={'hex'}
        value={String(value)}
        onChange={onChange}
      />
    );
  }

  if (spec.kind === 'select') {
    return (
      <NativeSelect
        label={spec.label}
        description={spec.hint}
        value={String(value)}
        data={spec.options.map((o) => ({ value: String(o.value), label: o.label }))}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    );
  }

  return (
    <NumberInput
      label={spec.label}
      description={spec.hint}
      min={spec.min ?? spec.exclusiveMin}
      max={spec.max}
      step={spec.step}
      value={value}
      onChange={onChange}
    />
  );
}

interface PatternSubFormProps {
  mode: 'add' | 'edit';
  initial: FormValues;
  namePlaceholder: string;
  existingNames: string[];
  busy: boolean;
  onSubmit: (values: FormValues) => void;
}

// Renders the inputs for a pattern's parameters straight from its `Fields` schema.
export function PatternSubForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: PatternSubFormProps) {
  const [values, setValues] = useState<FormValues>(initial);

  const nameTaken = mode === 'add' && existingNames.includes(values.name.trim());
  const nameError =
    values.name.trim() === ''
      ? 'Name is required'
      : nameTaken
        ? 'A pattern with this name already exists'
        : null;

  const setField = (key: string, value: number | string) =>
    setValues((v) => ({ ...v, values: { ...v.values, [key]: value } }));

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

      {rows(schemaFor(values.type)).map((row) => {
        const fields = row.map(([key, spec]) => (
          <Field
            key={key}
            spec={spec}
            value={values.values[key]}
            onChange={(value) => setField(key, value)}
          />
        ));
        if (fields.length === 1) return fields[0];
        return (
          <Group grow key={row[0][0]}>
            {fields}
          </Group>
        );
      })}

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

interface PatternFormProps {
  namePlaceholder: string;
  existingNames: string[];
  busy: boolean;
  onSubmit: (values: FormValues) => void;
}

// Add form: a type selector over the pattern registry plus that type's generated inputs.
export function PatternForm({
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: PatternFormProps) {
  const [type, setType] = useState<PatternType>(PATTERN_TYPES[0]);

  return (
    <Stack gap={'md'}>
      <NativeSelect
        label={'Type'}
        value={type}
        data={PATTERN_TYPES.map((t) => ({ value: t, label: patternDisplayName(t) }))}
        onChange={(e) => setType(e.currentTarget.value as PatternType)}
      />

      <PatternSubForm
        key={type}
        mode={'add'}
        initial={defaultsFor(type, namePlaceholder)}
        namePlaceholder={namePlaceholder}
        existingNames={existingNames}
        busy={busy}
        onSubmit={onSubmit}
      />
    </Stack>
  );
}
