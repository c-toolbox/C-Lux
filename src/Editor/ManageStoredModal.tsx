import { useState } from 'react';
import { ActionIcon, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';

import { type StoredPatternSet } from '../lib/api';

interface ManageStoredModalProps {
  opened: boolean;
  onClose: () => void;
  stored: StoredPatternSet[];
  patternCount: number;
  busy: boolean;
  storeName: string;
  onStoreNameChange: (name: string) => void;
  onStore: (name: string) => void;
  onAdd: (set: StoredPatternSet) => void;
  onRename: (name: string, newName: string) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (name: string) => void;
}

export function ManageStoredModal({
  opened,
  onClose,
  stored,
  patternCount,
  busy,
  storeName,
  onStoreNameChange,
  onStore,
  onAdd,
  onRename,
  onMove,
  onRemove
}: ManageStoredModalProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  function clearDrag() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  function handleDrop(index: number) {
    if (dragIndex !== null) onMove(dragIndex, index);
    clearDrag();
  }

  function confirmRemove() {
    const name = confirming;
    setConfirming(null);
    if (name !== null) onRemove(name);
  }

  return (
    <>
      <Modal opened={opened} onClose={onClose} title={'Manage stored patterns'} centered>
        <Stack gap={'md'}>
          <Group align={'flex-end'} gap={'xs'}>
            <TextInput
              label={'Store current patterns'}
              placeholder={'Name'}
              value={storeName}
              disabled={busy}
              onChange={(e) => onStoreNameChange(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              disabled={busy || patternCount === 0 || storeName.trim() === ''}
              onClick={() => onStore(storeName.trim())}
            >
              Store {patternCount} pattern(s)
            </Button>
          </Group>

          {stored.length === 0 ? (
            <Text c={'dimmed'} ta={'center'} py={'md'}>
              No stored patterns yet. Use the field above to save the current list.
            </Text>
          ) : (
            <Stack gap={'sm'}>
              {stored.map((set, i) => (
                <ManageStoredRow
                  key={set.name}
                  set={set}
                  index={i}
                  count={stored.length}
                  busy={busy}
                  dragging={dragIndex === i}
                  dropTarget={dragOverIndex === i}
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={clearDrag}
                  onDragOver={(e) => {
                    if (dragIndex === null) return;
                    e.preventDefault();
                    setDragOverIndex(i);
                  }}
                  onDrop={() => handleDrop(i)}
                  onMove={onMove}
                  onAdd={onAdd}
                  onRename={onRename}
                  onRemove={setConfirming}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={confirming !== null}
        onClose={() => setConfirming(null)}
        title={'Remove stored patterns'}
        centered
        zIndex={300}
      >
        <Stack gap={'md'}>
          <Text>
            Remove the stored pattern set &ldquo;{confirming}&rdquo;? This cannot be
            undone.
          </Text>
          <Group justify={'flex-end'} gap={'xs'}>
            <Button variant={'default'} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button color={'red'} disabled={busy} onClick={confirmRemove}>
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

interface ManageStoredRowProps {
  set: StoredPatternSet;
  index: number;
  count: number;
  busy: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onMove: (from: number, to: number) => void;
  onAdd: (set: StoredPatternSet) => void;
  onRename: (name: string, newName: string) => void;
  onRemove: (name: string) => void;
}

// A single editable row in the manage-stored modal: reorder, apply, rename, or remove a
// set.
function ManageStoredRow({
  set,
  index,
  count,
  busy,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onMove,
  onAdd,
  onRename,
  onRemove
}: ManageStoredRowProps) {
  const [name, setName] = useState(set.name);
  const trimmed = name.trim();
  const changed = trimmed !== '' && trimmed !== set.name;

  return (
    <Group
      align={'flex-end'}
      justify={'space-between'}
      gap={'xs'}
      p={'sm'}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        borderRadius: 8,
        opacity: dragging ? 0.5 : 1,
        border: dropTarget
          ? '2px solid var(--mantine-color-blue-5)'
          : '1px solid var(--mantine-color-default-border)'
      }}
    >
      <Group align={'flex-end'} gap={4} style={{ flex: 1 }}>
        <ActionIcon
          variant={'subtle'}
          color={'gray'}
          draggable={!busy}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
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
            disabled={busy || index === 0}
            onClick={() => onMove(index, index - 1)}
            aria-label={'Move stored pattern set up'}
          >
            ▲
          </ActionIcon>
          <ActionIcon
            variant={'subtle'}
            color={'gray'}
            size={'sm'}
            disabled={busy || index === count - 1}
            onClick={() => onMove(index, index + 1)}
            aria-label={'Move stored pattern set down'}
          >
            ▼
          </ActionIcon>
        </Stack>
        <TextInput
          label={`${set.patterns.length} pattern(s)`}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
      </Group>
      <Group gap={'xs'}>
        <Button size={'xs'} variant={'light'} disabled={busy} onClick={() => onAdd(set)}>
          Add
        </Button>
        <Button
          size={'xs'}
          disabled={busy || !changed}
          onClick={() => onRename(set.name, trimmed)}
        >
          Rename
        </Button>
        <Button
          size={'xs'}
          color={'red'}
          variant={'light'}
          disabled={busy}
          onClick={() => onRemove(set.name)}
        >
          Remove
        </Button>
      </Group>
    </Group>
  );
}
