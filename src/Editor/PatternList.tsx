import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  ColorSwatch,
  Group,
  Stack,
  Text
} from '@mantine/core';

import { patternDisplayName, type PatternParameters } from '../lib/api';
import { patternSwatchHex } from '../lib/color';

interface PatternListProps {
  patterns: PatternParameters[];
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onEdit: (pattern: PatternParameters) => void;
  onRemove: (name: string) => void;
}

export function PatternList({
  patterns,
  busy,
  onMove,
  onEdit,
  onRemove
}: PatternListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function handleDrop(index: number) {
    if (dragIndex !== null) onMove(dragIndex, index);
    setDragIndex(null);
    setDragOverIndex(null);
  }

  return (
    <Stack gap={'sm'}>
      {patterns.map((p, i) => (
        <Group
          key={p.name}
          justify={'space-between'}
          p={'md'}
          onDragOver={(e) => {
            if (dragIndex === null) return;
            e.preventDefault();
            setDragOverIndex(i);
          }}
          onDrop={() => handleDrop(i)}
          style={{
            borderRadius: 8,
            opacity: dragIndex === i ? 0.5 : 1,
            border:
              dragOverIndex === i
                ? '2px solid var(--mantine-color-blue-5)'
                : '1px solid var(--mantine-color-default-border)'
          }}
        >
          <Group>
            <ActionIcon
              variant={'subtle'}
              color={'gray'}
              draggable={!busy}
              onDragStart={() => setDragIndex(i)}
              onDragEnd={() => {
                setDragIndex(null);
                setDragOverIndex(null);
              }}
              style={{ cursor: 'grab' }}
              aria-label={'Drag to reorder'}
            >
              ⠿
            </ActionIcon>
            <Stack gap={2}>
              <ActionIcon
                variant={'subtle'}
                color={'gray'}
                size={'sm'}
                disabled={busy || i === 0}
                onClick={() => onMove(i, i - 1)}
                aria-label={'Move pattern up'}
              >
                ▲
              </ActionIcon>
              <ActionIcon
                variant={'subtle'}
                color={'gray'}
                size={'sm'}
                disabled={busy || i === patterns.length - 1}
                onClick={() => onMove(i, i + 1)}
                aria-label={'Move pattern down'}
              >
                ▼
              </ActionIcon>
            </Stack>
            <ColorSwatch color={patternSwatchHex(p)} />
            <div>
              <Text fw={600}>{p.name}</Text>
              <Group gap={'xs'} mt={4}>
                <Badge variant={'light'} size={'sm'}>
                  {patternDisplayName(p.type)}
                </Badge>
              </Group>
            </div>
          </Group>

          <Group gap={'xs'}>
            <Button size={'xs'} variant={'light'} onClick={() => onEdit(p)}>
              Edit
            </Button>
            <Button
              size={'xs'}
              color={'red'}
              variant={'light'}
              disabled={busy}
              onClick={() => onRemove(p.name)}
            >
              Remove
            </Button>
          </Group>
        </Group>
      ))}
    </Stack>
  );
}
