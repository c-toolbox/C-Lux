import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  ColorSwatch,
  Container,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  Title
} from '@mantine/core';

import names from '../assets/names.json' with { type: 'json' };
import {
  api,
  patternDisplayName,
  type PatternParameters,
  type StoredPatternSet
} from '../lib/api';
import { patternSwatchHex } from '../lib/color';
import {
  type FormValues,
  fromParameters,
  PatternForm,
  PatternSubForm,
  toProps
} from '../PatternForm/PatternForm';
import { PatternVisualizer } from '../PatternVisualizer/PatternVisualizer';

function randomName(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(names.adjectives)}-${pick(names.nouns)}`;
}

function Editor() {
  const [patterns, setPatterns] = useState<PatternParameters[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [namePlaceholder, setNamePlaceholder] = useState(randomName());
  const [editing, setEditing] = useState<PatternParameters | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [stored, setStored] = useState<StoredPatternSet[]>([]);
  const [storeName, setStoreName] = useState('');
  const [serverPaused, setServerPaused] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  async function refresh() {
    try {
      setPatterns(await api.listPatterns());
      setServerPaused((await api.serverPaused()).paused);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(values: FormValues) {
    await run(async () => {
      await api.addPattern(values.type, toProps(values));
      setAddOpen(false);
    });
  }

  async function handleEdit(values: FormValues) {
    await run(async () => {
      await api.updatePattern(values.name, toProps(values));
      setEditing(null);
    });
  }

  function handleRemove(name: string) {
    void run(() => api.removePattern(name));
  }

  function handleToggleServerPause() {
    void run(async () => {
      const next = !serverPaused;
      const res = await api.setServerPaused(next);
      setServerPaused(res.paused);
    });
  }

  async function refreshStored() {
    setStored(await api.storedPatterns());
  }

  function handleStore(name: string) {
    void run(async () => {
      await api.storePatterns(name);
      await refreshStored();
      setStoreName(randomName());
    });
  }

  function handleAddStored(set: StoredPatternSet) {
    void run(() => api.addStoredPatterns(set.name));
  }

  function handleRemoveStored(name: string) {
    void run(async () => {
      await api.removeStoredPattern(name);
      await refreshStored();
    });
  }

  function handleRenameStored(name: string, newName: string) {
    void run(async () => {
      await api.renameStoredPattern(name, newName);
      await refreshStored();
    });
  }

  async function openManage() {
    setError(null);
    try {
      await refreshStored();
      setStoreName(randomName());
      setManageOpen(true);
    } catch (e) {
      setError(describeError(e));
    }
  }

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= patterns.length) return;
    const order = patterns.map((p) => p.name);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    void run(() => api.reorderPatterns(order));
  }

  function handleDrop(index: number) {
    if (dragIndex !== null) move(dragIndex, index);
    setDragIndex(null);
    setDragOverIndex(null);
  }

  const existingNames = patterns.map((p) => p.name);

  return (
    <Container size={'sm'} py={'xl'}>
      <Title
        order={1}
        ta={'center'}
        style={{ position: 'fixed', top: 16, left: 0, right: 0, zIndex: 100 }}
      >
        C-Lux
      </Title>
      <Button
        component={Link}
        to={'/'}
        variant={'default'}
        style={{ position: 'fixed', top: 16, right: 16, zIndex: 100 }}
      >
        Home
      </Button>
      <Stack mt={'xl'}>
        <Group grow>
          <Button
            variant={serverPaused ? 'filled' : 'default'}
            color={serverPaused ? 'yellow' : undefined}
            disabled={busy}
            onClick={handleToggleServerPause}
            px={'xs'}
          >
            {serverPaused ? 'Resume all' : 'Pause all'}
          </Button>
          <Button variant={'default'} onClick={() => void openManage()} px={'xs'}>
            Manage stored
          </Button>
          <Button
            onClick={() => {
              setNamePlaceholder(randomName());
              setAddOpen(true);
            }}
            px={'xs'}
          >
            Add pattern
          </Button>
        </Group>

        {error && (
          <Alert
            color={'red'}
            title={'Error'}
            withCloseButton
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}

        {loading ? (
          <Group justify={'center'} py={'xl'}>
            <Loader />
          </Group>
        ) : patterns.length === 0 ? (
          <Text c={'dimmed'} ta={'center'} py={'xl'}>
            No patterns yet. Add one to get started.
          </Text>
        ) : (
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
                      onClick={() => move(i, i - 1)}
                      aria-label={'Move pattern up'}
                    >
                      ▲
                    </ActionIcon>
                    <ActionIcon
                      variant={'subtle'}
                      color={'gray'}
                      size={'sm'}
                      disabled={busy || i === patterns.length - 1}
                      onClick={() => move(i, i + 1)}
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
                  <Button size={'xs'} variant={'light'} onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                  <Button
                    size={'xs'}
                    color={'red'}
                    variant={'light'}
                    disabled={busy}
                    onClick={() => handleRemove(p.name)}
                  >
                    Remove
                  </Button>
                </Group>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>

      <PatternVisualizer />

      <Modal
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        title={'Add pattern'}
        centered
      >
        <PatternForm
          key={namePlaceholder}
          namePlaceholder={namePlaceholder}
          existingNames={existingNames}
          busy={busy}
          onSubmit={(values) => void handleAdd(values)}
        />
      </Modal>

      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : ''}
        centered
      >
        {editing && (
          <PatternSubForm
            mode={'edit'}
            initial={fromParameters(editing)}
            namePlaceholder={editing.name}
            existingNames={existingNames}
            busy={busy}
            onSubmit={(values) => void handleEdit(values)}
          />
        )}
      </Modal>

      <Modal
        opened={manageOpen}
        onClose={() => setManageOpen(false)}
        title={'Manage stored patterns'}
        centered
      >
        <Stack gap={'md'}>
          <Group align={'flex-end'} gap={'xs'}>
            <TextInput
              label={'Store current patterns'}
              placeholder={'Name'}
              value={storeName}
              disabled={busy}
              onChange={(e) => setStoreName(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              disabled={busy || patterns.length === 0 || storeName.trim() === ''}
              onClick={() => handleStore(storeName.trim())}
            >
              Store {patterns.length} pattern(s)
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
                  onAdd={handleAddStored}
                  onRename={handleRenameStored}
                  onRemove={handleRemoveStored}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Modal>
    </Container>
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

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default Editor;
