import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { TbDeviceFloppy, TbInfoCircle, TbPlus } from 'react-icons/tb';
import {
  ActionIcon,
  Anchor,
  Button,
  CloseButton,
  ColorInput,
  Group,
  Input,
  NativeSelect,
  NumberInput,
  Slider,
  Stack,
  TextInput,
  Tooltip
} from '@mantine/core';

import {
  type Color,
  colorCountRange,
  type ColorStop,
  type FieldSpec,
  isFieldVisible,
  PATTERN_TYPES,
  patternDisplayName,
  patternFields,
  type PatternParameters,
  type PatternProps,
  type PatternSchema,
  type PatternType
} from '../lib/api';
import { hexToRgb, rgbToHex } from '../lib/color';
import { PatternPreview } from '../PatternVisualizer/PatternPreview';

import type { CaptureFormProps } from './capture';
import { ColorMapInput, type StopValue } from './ColorMapInput';

export interface FormValues {
  type: PatternType;
  name: string;
  // Keyed by the pattern's schema fields: hex strings for colors, a list of them for
  // palettes, positioned hex colors for color maps, strings for text, numbers otherwise.
  values: Record<string, FieldValue>;
}

type FieldValue = number | string | string[] | StopValue[];

function schemaFor(type: PatternType): PatternSchema {
  return patternFields(type) ?? {};
}

const num = (v: FieldValue) => (typeof v === 'number' ? v : Number(v) || 0);
const text = (v: FieldValue) => (Array.isArray(v) ? '' : String(v));

const toStopValues = (stops: ColorStop[]): StopValue[] =>
  stops.map(({ t, ...color }) => ({ t, color: rgbToHex(color) }));

function defaultsFor(type: PatternType, name: string): FormValues {
  const values: Record<string, FieldValue> = {};
  for (const [key, spec] of Object.entries(schemaFor(type))) {
    if (spec.kind === 'color') values[key] = rgbToHex(spec.default);
    else if (spec.kind === 'colors') values[key] = spec.default.map(rgbToHex);
    else if (spec.kind === 'colorMap') values[key] = toStopValues(spec.default);
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
    } else if (spec.kind === 'colorMap') {
      props[key] = asStops(value).map((s) => ({ t: s.t, ...hexToRgb(s.color) }));
    } else if (spec.kind === 'text') {
      props[key] = text(value).trim();
    } else if (spec.kind !== 'color') {
      props[key] = num(value);
    } else if (key === 'color') {
      // The primary color is flattened into r/g/b, the shape pattern constructors take.
      Object.assign(props, hexToRgb(text(value)));
    } else {
      props[key] = hexToRgb(text(value));
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
    } else if (spec.kind === 'colorMap') {
      const stops = Array.isArray(value) && value.length > 0 ? value : spec.default;
      values[key] = toStopValues(stops as ColorStop[]);
    } else if (spec.kind === 'text') {
      values[key] = typeof value === 'string' ? value : spec.default;
    } else {
      values[key] = typeof value === 'number' ? value : spec.default;
    }
  }
  return { type: p.type, name: p.name, values };
}

const asList = (value: FieldValue): string[] =>
  Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];

const asStops = (value: FieldValue): StopValue[] =>
  Array.isArray(value) ? value.filter((v) => typeof v === 'object') : [];

type Entry = [string, FieldSpec];

// Group consecutive fields that share a row number so they render side by side.
function rows(
  schema: PatternSchema,
  values: Record<string, FieldValue>,
  hidden: readonly string[]
): Entry[][] {
  const grouped: Entry[][] = [];
  for (const entry of Object.entries(schema)) {
    if (hidden.includes(entry[0]) || !isFieldVisible(entry[1], values)) continue;
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

// Shows `text` on hover, and keeps it open after a click until the icon loses focus.
function InfoTip({ text }: { text: string }) {
  const [pinned, setPinned] = useState(false);
  return (
    // Left uncontrolled while unpinned so the tooltip's own hover handling applies.
    <Tooltip label={text} opened={pinned || undefined} multiline maw={300} withArrow>
      <ActionIcon
        variant={'subtle'}
        color={'gray'}
        size={'xs'}
        display={'inline-flex'}
        style={{ verticalAlign: 'text-bottom' }}
        aria-label={text}
        onClick={(e) => {
          // Keep the surrounding <label> from focusing its input.
          e.preventDefault();
          setPinned((p) => !p);
        }}
        onBlur={() => setPinned(false)}
      >
        <TbInfoCircle />
      </ActionIcon>
    </Tooltip>
  );
}

function fieldLabel(spec: FieldSpec): ReactNode {
  if (!spec.hint) return spec.label;
  // Keep the icon on the same line as the label's last word when the label wraps.
  const split = spec.label.lastIndexOf(' ') + 1;
  return (
    <>
      {spec.label.slice(0, split)}
      <span style={{ whiteSpace: 'nowrap' }}>
        {spec.label.slice(split)} <InfoTip text={spec.hint} />
      </span>
    </>
  );
}

function Field({ spec, value, onChange }: FieldProps) {
  const label = fieldLabel(spec);
  if (spec.kind === 'color') {
    return (
      <ColorInput label={label} format={'hexa'} value={text(value)} onChange={onChange} />
    );
  }

  if (spec.kind === 'colors') {
    const colors = asList(value);
    const count = colorCountRange(spec);
    const replace = (index: number, color: string) =>
      onChange(colors.map((c, i) => (i === index ? color : c)));
    return (
      <Input.Wrapper label={label}>
        <Stack gap={'xs'} mt={'xs'}>
          {colors.map((color, index) => (
            <Group gap={'xs'} key={index} wrap={'nowrap'}>
              <ColorInput
                style={{ flex: 1 }}
                format={'hexa'}
                value={color}
                onChange={(c) => replace(index, c)}
              />
              <CloseButton
                aria-label={'Remove color'}
                disabled={colors.length <= count.min}
                onClick={() => onChange(colors.filter((_, i) => i !== index))}
              />
            </Group>
          ))}
          <Button
            variant={'light'}
            size={'xs'}
            disabled={colors.length >= count.max}
            leftSection={<TbPlus />}
            onClick={() =>
              onChange([...colors, colors[colors.length - 1] ?? '#ffffffff'])
            }
          >
            Add color
          </Button>
        </Stack>
      </Input.Wrapper>
    );
  }

  if (spec.kind === 'colorMap') {
    return <ColorMapInput label={label} value={asStops(value)} onChange={onChange} />;
  }

  if (spec.kind === 'select') {
    return (
      <NativeSelect
        label={label}
        value={text(value)}
        data={spec.options.map((o) => ({ value: String(o.value), label: o.label }))}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    );
  }

  if (spec.kind === 'text') {
    return (
      <TextInput
        label={label}
        maxLength={spec.maxLength}
        value={text(value)}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    );
  }

  if (spec.kind === 'slider') {
    return (
      <Input.Wrapper label={label}>
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
      label={label}
      min={spec.min ?? spec.exclusiveMin}
      max={spec.max}
      step={spec.step}
      value={Array.isArray(value) ? spec.default : value}
      onChange={onChange}
    />
  );
}

type PatternSubFormProps = {
  initial: FormValues;
  busy: boolean;
  // Names the pattern may not take; in edit mode this excludes the pattern's own name,
  // and a taken name is only a warning since the rename can overwrite it.
  existingNames: string[];
  onSubmit: (values: FormValues) => void;
} & ({ mode: 'add'; namePlaceholder: string } | { mode: 'edit' }) & {
    onValuesChange?: (values: FormValues) => void;
    // Inputs shown above the name.
    header?: ReactNode;
    // Floated top-right, with the inputs flowing around and below it.
    preview?: ReactNode;
    // Fields left to `panel` rather than given an input of their own.
    hiddenFields?: readonly string[];
    // Shown below the inputs, and able to change the values like they can. `field`
    // renders the input for a schema field, so a hidden one can be placed in the panel.
    panel?: (
      values: FormValues,
      setField: (key: string, value: number | string) => void,
      field: (key: string) => ReactNode
    ) => ReactNode;
  };

// Renders the inputs for a pattern's parameters straight from its `Fields` schema.
export function PatternSubForm(props: PatternSubFormProps) {
  const { initial, busy, onSubmit } = props;
  const { onValuesChange } = props;
  const [values, setValues] = useState<FormValues>(initial);

  useEffect(() => {
    onValuesChange?.(values);
  }, [values, onValuesChange]);

  const nameTaken = props.existingNames.includes(values.name.trim());
  const nameError =
    values.name.trim() === ''
      ? 'Name is required'
      : nameTaken && props.mode === 'add'
        ? 'A pattern with this name already exists'
        : null;
  const nameWarning =
    nameTaken && props.mode === 'edit'
      ? 'A pattern with this name already exists and will be overwritten'
      : null;

  const setField = (key: string, value: FieldValue) =>
    setValues((v) => ({ ...v, values: { ...v.values, [key]: value } }));
  const field = (key: string) => {
    const spec = schemaFor(values.type)[key];
    return (
      spec && (
        <Field
          key={key}
          spec={spec}
          value={values.values[key]}
          onChange={(value) => setField(key, value)}
        />
      )
    );
  };
  const panel = props.panel?.(values, setField, field);

  const fieldRows = rows(
    schemaFor(values.type),
    values.values,
    props.hiddenFields ?? []
  ).map((row) => {
    const fields = row.map(([key, spec]) => (
      <Field
        key={key}
        spec={spec}
        value={values.values[key]}
        onChange={(value) => setField(key, value)}
      />
    ));
    return (
      <div key={row[0][0]}>
        {fields.length === 1 ? fields[0] : <Group grow>{fields}</Group>}
      </div>
    );
  });

  return (
    <div className={'pattern-layout'}>
      <div className={'pattern-layout-preview'}>{props.preview}</div>
      <div className={'pattern-layout-rows'}>
        {props.header !== undefined && <div>{props.header}</div>}
        <div>
          <TextInput
            label={'Name'}
            placeholder={props.mode === 'add' ? props.namePlaceholder : undefined}
            value={values.name}
            error={nameError}
            description={nameWarning}
            styles={
              nameWarning
                ? { description: { color: 'var(--mantine-color-orange-6)' } }
                : undefined
            }
            onChange={(e) => {
              // Read the value now: React nulls out `currentTarget` before the lazy
              // updater below runs.
              const name = e.currentTarget.value;
              setValues((v) => ({ ...v, name }));
            }}
          />
        </div>

        {fieldRows}

        {panel && <div>{panel}</div>}

        <div>
          <Button
            fullWidth
            onClick={() => onSubmit(values)}
            loading={busy}
            disabled={nameError !== null}
            leftSection={props.mode === 'add' ? <TbPlus /> : <TbDeviceFloppy />}
          >
            {props.mode === 'add' ? 'Add pattern' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

const TYPE_OPTIONS = PATTERN_TYPES.map((t) => ({
  value: t,
  label: patternDisplayName(t)
})).sort((a, b) => a.label.localeCompare(b.label));

const WIKI_URL = 'https://github.com/c-toolbox/C-Lux/wiki';

// The wiki's headings are the display names, so GitHub's heading slug is the anchor.
function wikiUrl(type: PatternType): string {
  return `${WIKI_URL}#${patternDisplayName(type).toLowerCase().replace(/\s+/g, '-')}`;
}

interface PatternFormProps {
  namePlaceholder: string;
  existingNames: string[];
  busy: boolean;
  onSubmit: (values: FormValues) => void;
  // The capture panel for a type, and the feed it publishes to for the preview to read.
  capture?: (type: PatternType) => CaptureFormProps;
  captureFeed?: string;
}

// Add form: a type selector over the pattern registry plus that type's generated inputs.
export function PatternForm({
  namePlaceholder,
  existingNames,
  busy,
  onSubmit,
  capture,
  captureFeed
}: PatternFormProps) {
  const [type, setType] = useState<PatternType>(PATTERN_TYPES[0]);
  const [current, setCurrent] = useState<FormValues | null>(null);
  const previewProps = useMemo(
    () =>
      current && current.type === type
        ? { ...toProps(current), name: captureFeed ?? current.name }
        : null,
    [current, type, captureFeed]
  );

  return (
    <PatternSubForm
      key={type}
      mode={'add'}
      initial={defaultsFor(type, namePlaceholder)}
      namePlaceholder={namePlaceholder}
      existingNames={existingNames}
      busy={busy}
      onSubmit={onSubmit}
      onValuesChange={setCurrent}
      {...capture?.(type)}
      preview={previewProps && <PatternPreview type={type} props={previewProps} />}
      header={
        <NativeSelect
          label={'Type'}
          description={
            <Anchor
              href={wikiUrl(type)}
              target={'_blank'}
              rel={'noopener noreferrer'}
              size={'xs'}
            >
              Get more information on the documentation page
            </Anchor>
          }
          inputWrapperOrder={['label', 'input', 'description', 'error']}
          value={type}
          data={TYPE_OPTIONS}
          onChange={(e) => setType(e.currentTarget.value as PatternType)}
        />
      }
    />
  );
}
