import { type PointerEvent, useRef } from 'react';
import { TbPlus } from 'react-icons/tb';
import {
  Box,
  Button,
  CloseButton,
  ColorInput,
  Group,
  Input,
  NumberInput,
  Stack
} from '@mantine/core';

import { MAX_COLORS, sampleColorMap } from '../lib/api';
import { hexToRgb, rgbToHex } from '../lib/color';

// A color map keyframe as the form holds it: the color as `#rrggbbaa` hex.
export interface StopValue {
  t: number;
  color: string;
}

const clampUnit = (t: number) => Math.max(0, Math.min(1, t));
const roundPosition = (t: number) => Math.round(clampUnit(t) * 100) / 100;

function colorAt(stops: StopValue[], t: number): string {
  return rgbToHex(
    sampleColorMap(
      stops.map((s) => ({ t: s.t, ...hexToRgb(s.color) })),
      t
    )
  );
}

// The middle of the widest stretch without a stop, where a new one is least in the way.
function freePosition(stops: StopValue[]): number {
  const points = [0, ...stops.map((s) => s.t).sort((a, b) => a - b), 1];
  let best = 0.5;
  let widest = -1;
  for (let i = 1; i < points.length; i++) {
    if (points[i] - points[i - 1] > widest) {
      widest = points[i] - points[i - 1];
      best = (points[i] + points[i - 1]) / 2;
    }
  }
  return roundPosition(best);
}

function background(stops: StopValue[]): string {
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  const fill =
    sorted.length === 1
      ? `linear-gradient(${sorted[0].color}, ${sorted[0].color})`
      : `linear-gradient(to right, ${sorted.map((s) => `${s.color} ${s.t * 100}%`).join(', ')})`;
  // A checkerboard underneath shows through transparent stops.
  return `${fill}, repeating-conic-gradient(#888 0 25%, #bbb 0 50%) 0 0 / 12px 12px`;
}

interface ColorMapInputProps {
  label: string;
  description?: string;
  value: StopValue[];
  onChange: (value: StopValue[]) => void;
}

// Edits a list of color keyframes: drag a handle along the bar to move a stop, click the
// bar to add one there, or edit the stops in the list below.
export function ColorMapInput({
  label,
  description,
  value,
  onChange
}: ColorMapInputProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const positionOf = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return roundPosition((clientX - rect.left) / rect.width);
  };

  const update = (index: number, change: Partial<StopValue>) =>
    onChange(value.map((s, i) => (i === index ? { ...s, ...change } : s)));

  const add = (t: number) => {
    if (value.length >= MAX_COLORS) return;
    onChange([...value, { t, color: colorAt(value, t) }]);
  };

  const startDrag = (index: number) => (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = index;
  };
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current === null) return;
    update(dragging.current, { t: positionOf(e.clientX) });
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragging.current = null;
  };

  // Listed by position so the rows read like the bar, while keeping each stop's index.
  const order = value.map((_, i) => i).sort((a, b) => value[a].t - value[b].t);

  return (
    <Input.Wrapper label={label} description={description}>
      <Box mt={'xs'} pos={'relative'} pb={18} px={7}>
        <Box
          ref={barRef}
          h={24}
          title={value.length < MAX_COLORS ? 'Click to add a stop' : undefined}
          style={{
            borderRadius: 4,
            background: background(value),
            cursor: value.length < MAX_COLORS ? 'copy' : 'default'
          }}
          onClick={(e) => add(positionOf(e.clientX))}
        />
        {value.map((stop, index) => (
          <Box
            key={index}
            role={'slider'}
            aria-label={`Stop ${index + 1} position`}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={stop.t}
            onPointerDown={startDrag(index)}
            onPointerMove={drag}
            onPointerUp={endDrag}
            style={{
              position: 'absolute',
              top: 18,
              left: `calc(7px + (100% - 14px) * ${stop.t})`,
              transform: 'translateX(-50%)',
              width: 14,
              height: 14,
              borderRadius: '50%',
              border: '2px solid white',
              boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.6)',
              background: stop.color,
              cursor: 'ew-resize',
              touchAction: 'none'
            }}
          />
        ))}
      </Box>
      <Stack gap={'xs'} mt={'xs'}>
        {order.map((index) => (
          <Group gap={'xs'} key={index} wrap={'nowrap'}>
            <ColorInput
              style={{ flex: 1 }}
              format={'hexa'}
              value={value[index].color}
              onChange={(color) => update(index, { color })}
            />
            <NumberInput
              w={90}
              aria-label={'Position'}
              min={0}
              max={1}
              step={0.05}
              decimalScale={2}
              clampBehavior={'strict'}
              value={value[index].t}
              onChange={(t) => {
                const n = typeof t === 'number' ? t : Number(t);
                if (Number.isFinite(n)) update(index, { t: clampUnit(n) });
              }}
            />
            <CloseButton
              aria-label={'Remove stop'}
              disabled={value.length <= 1}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            />
          </Group>
        ))}
        <Button
          variant={'light'}
          size={'xs'}
          disabled={value.length >= MAX_COLORS}
          leftSection={<TbPlus />}
          onClick={() => add(freePosition(value))}
        >
          Add stop
        </Button>
      </Stack>
    </Input.Wrapper>
  );
}
