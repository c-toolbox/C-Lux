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
  Title,
  Tooltip
} from '@mantine/core';

import {
  api,
  type PatternParameters,
  type StoredPatternSet
} from './lib/api';
import { rgbToHex } from './lib/color';

import {
  type FormValues,
  fromParameters,
  PatternForm,
  PatternSubForm,
  toProps
} from './PatternForm/PatternForm';
import { PatternVisualizer } from './PatternVisualizer/PatternVisualizer';

import names from './assets/names.json' with { type: 'json' };

function randomName(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(names.adjectives)}-${pick(names.nouns)}`;
}

function App() {
  const [patterns, setPatterns] = useState<PatternParameters[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [namePlaceholder, setNamePlaceholder] = useState(randomName());
  const [editing, setEditing] = useState<PatternParameters | null>(null);
  const [storedOpen, setStoredOpen] = useState(false);
  const [stored, setStored] = useState<StoredPatternSet[]>([]);
  const [storeOpen, setStoreOpen] = useState(false);
  const [storeName, setStoreName] = useState('');

  async function refresh() {
    try {
      setPatterns(await api.listPatterns());
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
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
    run(() => api.removePattern(name));
  }

  async function refreshStored() {
    setStored(await api.storedPatterns());
  }

  async function openStored() {
    setError(null);
    try {
      await refreshStored();
      setStoredOpen(true);
    } catch (e) {
      setError(describeError(e));
    }
  }

  function handleStore(name: string) {
    run(async () => {
      await api.storePatterns(name);
      setStoreOpen(false);
    });
  }

  function handleAddStored(set: StoredPatternSet) {
    run(async () => {
      await api.addStoredPatterns(set.name);
      setStoredOpen(false);
    });
  }

  function handleRemoveStored(name: string) {
    run(async () => {
      await api.removeStoredPattern(name);
      await refreshStored();
    });
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= patterns.length) return;
    const order = patterns.map((p) => p.name);
    [order[index], order[target]] = [order[target], order[index]];
    run(() => api.reorderPatterns(order));
  }

  const existingNames = patterns.map((p) => p.name);

  return (
    <Container size={'sm'} py={'xl'}>
      <Stack gap={'lg'}>
        <Group justify={'space-between'} align={'center'}>
          <div>
            <Title order={1}>C-Lux</Title>
            <Text c={'dimmed'}>Lighting pattern control</Text>
          </div>
          <Button component={Link} to={'/'} variant={'default'}>
            Home
          </Button>
        </Group>

        <Group justify={'space-between'}>
          <Text fw={500}>{patterns.length} pattern(s)</Text>
          <Group gap={'xs'}>
            <Button variant={'default'} onClick={openStored}>
              Add stored
            </Button>
            <Button
              variant={'default'}
              disabled={busy || patterns.length === 0}
              onClick={() => {
                setStoreName(randomName());
                setStoreOpen(true);
              }}
            >
              Store patterns
            </Button>
            <Button
              onClick={() => {
                setNamePlaceholder(randomName());
                setAddOpen(true);
              }}
            >
              Add pattern
            </Button>
          </Group>
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
                style={{
                  border: '1px solid var(--mantine-color-default-border)',
                  borderRadius: 8
                }}
              >
                <Group>
                  <ColorSwatch color={rgbToHex(p.color)} />
                  <div>
                    <Text fw={600}>{p.name}</Text>
                    <Badge variant={'light'} size={'sm'}>
                      {p.type}
                    </Badge>
                  </div>
                </Group>

                <Group gap={'xs'}>
                  <Tooltip label={'Move up'}>
                    <ActionIcon
                      variant={'subtle'}
                      disabled={i === 0 || busy}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={'Move down'}>
                    <ActionIcon
                      variant={'subtle'}
                      disabled={i === patterns.length - 1 || busy}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </ActionIcon>
                  </Tooltip>
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

      <Stack gap={'sm'} mt={'xl'}>
        <Title order={3}>Visualizer</Title>
        <PatternVisualizer />
      </Stack>

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
          onSubmit={handleAdd}
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
            onSubmit={handleEdit}
          />
        )}
      </Modal>

      <Modal
        opened={storedOpen}
        onClose={() => setStoredOpen(false)}
        title={'Stored patterns'}
        centered
      >
        {stored.length === 0 ? (
          <Text c={'dimmed'} ta={'center'} py={'md'}>
            No stored patterns yet. Use “Store patterns” to save the current list.
          </Text>
        ) : (
          <Stack gap={'sm'}>
            {stored.map((set) => (
              <Group
                key={set.name}
                justify={'space-between'}
                p={'sm'}
                style={{
                  border: '1px solid var(--mantine-color-default-border)',
                  borderRadius: 8
                }}
              >
                <div>
                  <Text fw={600}>{set.name}</Text>
                  <Group gap={4} mt={4}>
                    {set.patterns.map((p) => (
                      <ColorSwatch key={p.name} color={rgbToHex(p.color)} size={16} />
                    ))}
                    <Badge variant={'light'} size={'sm'}>
                      {set.patterns.length} pattern(s)
                    </Badge>
                  </Group>
                </div>

                <Group gap={'xs'}>
                  <Button
                    size={'xs'}
                    variant={'light'}
                    disabled={busy}
                    onClick={() => handleAddStored(set)}
                  >
                    Add
                  </Button>
                  <Button
                    size={'xs'}
                    color={'red'}
                    variant={'light'}
                    disabled={busy}
                    onClick={() => handleRemoveStored(set.name)}
                  >
                    Delete
                  </Button>
                </Group>
              </Group>
            ))}
          </Stack>
        )}
      </Modal>

      <Modal
        opened={storeOpen}
        onClose={() => setStoreOpen(false)}
        title={'Store patterns'}
        centered
      >
        <Stack gap={'md'}>
          <TextInput
            label={'Name'}
            value={storeName}
            onChange={(e) => setStoreName(e.currentTarget.value)}
          />
          <Button
            disabled={busy || storeName.trim() === ''}
            onClick={() => handleStore(storeName.trim())}
          >
            Store {patterns.length} pattern(s)
          </Button>
        </Stack>
      </Modal>
    </Container>
  );
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default App;
