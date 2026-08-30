import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Stack, Switch, Text } from '@mantine/core';

import { patternDisplayName, type PatternParameters } from '../lib/api';

interface PatternListProps {
  patterns: PatternParameters[];
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onEdit: (pattern: PatternParameters) => void;
  onToggleEnabled: (name: string, enabled: boolean) => void;
  onRemove: (name: string) => void;
}

export function PatternList({
  patterns,
  busy,
  onMove,
  onEdit,
  onToggleEnabled,
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
            <div style={{ opacity: p.enabled ? 1 : 0.5 }}>
              <Text fw={600}>{p.name}</Text>
              <Group gap={'xs'} mt={4}>
                <Badge variant={'light'} size={'sm'}>
                  {patternDisplayName(p.type)}
                </Badge>
                {!p.enabled && (
                  <Badge variant={'light'} color={'gray'} size={'sm'}>
                    Disabled
                  </Badge>
                )}
              </Group>
            </div>
          </Group>

          <Group gap={'xs'}>
            <Switch
              size={'sm'}
              checked={p.enabled}
              disabled={busy}
              onChange={(e) => onToggleEnabled(p.name, e.currentTarget.checked)}
              aria-label={p.enabled ? 'Disable pattern' : 'Enable pattern'}
            />
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
