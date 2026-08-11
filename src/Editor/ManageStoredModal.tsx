import { useState } from 'react';
import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';

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
  onRemove
}: ManageStoredModalProps) {
  return (
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
            {stored.map((set) => (
              <ManageStoredRow
                key={set.name}
                set={set}
                busy={busy}
                onAdd={onAdd}
                onRename={onRename}
                onRemove={onRemove}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

interface ManageStoredRowProps {
  set: StoredPatternSet;
  busy: boolean;
  onAdd: (set: StoredPatternSet) => void;
  onRename: (name: string, newName: string) => void;
  onRemove: (name: string) => void;
}

// A single editable row in the manage-stored modal: apply, rename, or remove a set.
function ManageStoredRow({ set, busy, onAdd, onRename, onRemove }: ManageStoredRowProps) {
  const [name, setName] = useState(set.name);
  const trimmed = name.trim();
  const changed = trimmed !== '' && trimmed !== set.name;

  return (
    <Group
      align={'flex-end'}
      justify={'space-between'}
      p={'sm'}
      style={{
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 8
      }}
    >
      <TextInput
        label={`${set.patterns.length} pattern(s)`}
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.currentTarget.value)}
        style={{ flex: 1 }}
      />
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
