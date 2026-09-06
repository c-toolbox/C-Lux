import { useState } from 'react';
import {
  Button,
  CloseButton,
  ColorInput,
  Group,
  Input,
  NativeSelect,
  NumberInput,
  Slider,
  Stack,
  TextInput
} from '@mantine/core';

import {
  type Color,
  type FieldSpec,
  MAX_COLORS,
  PATTERN_TYPES,
  patternDisplayName,
  patternFields,
  type PatternParameters,
  type PatternProps,
  type PatternSchema,
  type PatternType
} from '../lib/api';
import { hexToRgb, rgbToHex } from '../lib/color';

export interface FormValues {
  type: PatternType;
  name: string;
  // Keyed by the pattern's schema fields: hex strings for colors, a list of them for
  // palettes, numbers otherwise.
  values: Record<string, FieldValue>;
}

type FieldValue = number | string | string[];

function schemaFor(type: PatternType): PatternSchema {
  return patternFields(type) ?? {};
}

const num = (v: FieldValue) => (typeof v === 'number' ? v : Number(v) || 0);

function defaultsFor(type: PatternType, name: string): FormValues {
  const values: Record<string, FieldValue> = {};
  for (const [key, spec] of Object.entries(schemaFor(type))) {
    if (spec.kind === 'color') values[key] = rgbToHex(spec.default);
    else if (spec.kind === 'colors') values[key] = spec.default.map(rgbToHex);
    else values[key] = spec.default;
  }
  return { type, name, values };
}

export function toProps(values: FormValues): PatternProps {
  const props: Record<string, unknown> = { name: values.name };
  for (const [key, spec] of Object.entries(schemaFor(values.type))) {
    const value = values.values[key];
    if (spec.kind === 'colors') {
      props[key] = asList(value).map(hexToRgb);
    } else if (spec.kind !== 'color') {
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
  const values: Record<string, FieldValue> = {};
  for (const [key, spec] of Object.entries(schemaFor(p.type))) {
    const value = stored[key];
    if (spec.kind === 'color') {
      values[key] = rgbToHex((value ?? spec.default) as Color);
    } else if (spec.kind === 'colors') {
      const palette = Array.isArray(value) && value.length > 0 ? value : spec.default;
      values[key] = (palette as Color[]).map(rgbToHex);
    } else {
      values[key] = typeof value === 'number' ? value : spec.default;
    }
  }
  return { type: p.type, name: p.name, values };
}

const asList = (value: FieldValue) => (Array.isArray(value) ? value : []);

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
  value: FieldValue;
  onChange: (value: FieldValue) => void;
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

  if (spec.kind === 'colors') {
    const colors = asList(value);
    const replace = (index: number, color: string) =>
      onChange(colors.map((c, i) => (i === index ? color : c)));
    return (
      <Input.Wrapper label={spec.label} description={spec.hint}>
        <Stack gap={'xs'} mt={'xs'}>
          {colors.map((color, index) => (
            <Group gap={'xs'} key={index} wrap={'nowrap'}>
              <ColorInput
                style={{ flex: 1 }}
                format={'hex'}
                value={color}
                onChange={(c) => replace(index, c)}
              />
              <CloseButton
                aria-label={'Remove color'}
                disabled={colors.length <= 1}
                onClick={() => onChange(colors.filter((_, i) => i !== index))}
              />
            </Group>
          ))}
          <Button
            variant={'light'}
            size={'xs'}
            disabled={colors.length >= MAX_COLORS}
            onClick={() => onChange([...colors, colors[colors.length - 1] ?? '#ffffff'])}
          >
            Add color
          </Button>
        </Stack>
      </Input.Wrapper>
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

  if (spec.kind === 'slider') {
    return (
      <Input.Wrapper label={spec.label} description={spec.hint}>
        <Slider
          mt={'xs'}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={num(value)}
          onChange={onChange}
        />
      </Input.Wrapper>
    );
  }

  return (
    <NumberInput
      label={spec.label}
      description={spec.hint}
      min={spec.min ?? spec.exclusiveMin}
      max={spec.max}
      step={spec.step}
      value={Array.isArray(value) ? spec.default : value}
      onChange={onChange}
    />
  );
}

// The name is fixed once a pattern exists, so only the add form needs a placeholder and
// the list of names to reject.
type PatternSubFormProps = {
  initial: FormValues;
  busy: boolean;
  onSubmit: (values: FormValues) => void;
} & (
  { mode: 'add'; namePlaceholder: string; existingNames: string[] } | { mode: 'edit' }
);

// Renders the inputs for a pattern's parameters straight from its `Fields` schema.
export function PatternSubForm(props: PatternSubFormProps) {
  const { initial, busy, onSubmit } = props;
  const [values, setValues] = useState<FormValues>(initial);

  const nameTaken =
    props.mode === 'add' && props.existingNames.includes(values.name.trim());
  const nameError =
    values.name.trim() === ''
      ? 'Name is required'
      : nameTaken
        ? 'A pattern with this name already exists'
        : null;

  const setField = (key: string, value: FieldValue) =>
    setValues((v) => ({ ...v, values: { ...v.values, [key]: value } }));

  return (
    <Stack gap={'md'}>
      <TextInput
        label={'Name'}
        placeholder={props.mode === 'add' ? props.namePlaceholder : undefined}
        value={values.name}
        error={nameError}
        disabled={props.mode === 'edit'}
        onChange={(e) => {
          // Read the value now: React nulls out `currentTarget` before the lazy
          // updater below runs.
          const name = e.currentTarget.value;
          setValues((v) => ({ ...v, name }));
        }}
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
        {props.mode === 'add' ? 'Add pattern' : 'Save changes'}
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
