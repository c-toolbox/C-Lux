import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title
} from '@mantine/core';

import { api, type PatternParameters, type StoredPatternSet } from '../lib/api';
import { type FormValues, toProps } from '../PatternForm/PatternForm';
import { PatternVisualizer } from '../PatternVisualizer/PatternVisualizer';

import { AddPatternModal } from './AddPatternModal';
import { EditPatternModal } from './EditPatternModal';
import { ManageStoredModal } from './ManageStoredModal';
import { PatternList } from './PatternList';
import { describeError, randomName } from './utils';

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

  const existingNames = patterns.map((p) => p.name);

  return (
    <Container size={'sm'} w={'100%'} py={'xl'}>
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
          <PatternList
            patterns={patterns}
            busy={busy}
            onMove={move}
            onEdit={setEditing}
            onRemove={handleRemove}
          />
        )}
      </Stack>

      <PatternVisualizer />

      <AddPatternModal
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        namePlaceholder={namePlaceholder}
        existingNames={existingNames}
        busy={busy}
        onSubmit={(values) => void handleAdd(values)}
      />

      <EditPatternModal
        editing={editing}
        onClose={() => setEditing(null)}
        existingNames={existingNames}
        busy={busy}
        onSubmit={(values) => void handleEdit(values)}
      />

      <ManageStoredModal
        opened={manageOpen}
        onClose={() => setManageOpen(false)}
        stored={stored}
        patternCount={patterns.length}
        busy={busy}
        storeName={storeName}
        onStoreNameChange={setStoreName}
        onStore={handleStore}
        onAdd={handleAddStored}
        onRename={handleRenameStored}
        onRemove={handleRemoveStored}
      />
    </Container>
  );
}

export default Editor;
