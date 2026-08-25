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

import { api, AUDIO_TYPE, type PatternParameters, type Scene } from '../lib/api';
import { authRequired, signOut } from '../lib/auth';
import { type FormValues, toProps } from '../PatternForm/PatternForm';
import { PatternVisualizer } from '../PatternVisualizer/PatternVisualizer';

import { AddPatternModal } from './AddPatternModal';
import { AudioCapture } from './AudioCapture';
import { EditPatternModal } from './EditPatternModal';
import { ManageScenesModal } from './ManageScenesModal';
import { PatternList } from './PatternList';
import { describeError, downloadJson, randomName, readJsonFile } from './utils';

function Editor() {
  const [patterns, setPatterns] = useState<PatternParameters[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [namePlaceholder, setNamePlaceholder] = useState(randomName());
  const [editing, setEditing] = useState<PatternParameters | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [newSceneName, setNewSceneName] = useState('');
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
    let failure: string | null = null;
    try {
      await action();
    } catch (e) {
      failure = describeError(e);
    }
    await refresh();
    if (failure) setError(failure);
    setBusy(false);
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

  function handleToggleEnabled(name: string, enabled: boolean) {
    void run(() => api.setPatternEnabled(name, enabled));
  }

  function handleToggleServerPause() {
    void run(async () => {
      const next = !serverPaused;
      const res = await api.setServerPaused(next);
      setServerPaused(res.paused);
    });
  }

  async function refreshScenes() {
    setScenes(await api.listScenes());
  }

  function handleSaveScene(name: string) {
    void run(async () => {
      await api.saveScene(name);
      await refreshScenes();
      setNewSceneName(randomName());
    });
  }

  function handleApplyScene(scene: Scene) {
    void run(() => api.applyScene(scene.name));
  }

  function handleDeleteScene(name: string) {
    void run(async () => {
      await api.deleteScene(name);
      await refreshScenes();
    });
  }

  function handleRenameScene(name: string, newName: string) {
    void run(async () => {
      await api.renameScene(name, newName);
      await refreshScenes();
    });
  }

  function handleExportScene(scene: Scene) {
    setError(null);
    try {
      downloadJson(scene.name, scene);
    } catch (e) {
      setError(describeError(e));
    }
  }

  function handleImportScene(file: File) {
    void run(async () => {
      await api.importScene(await readJsonFile(file));
      await refreshScenes();
    });
  }

  function moveScene(from: number, to: number) {
    if (from === to || to < 0 || to >= scenes.length) return;
    const order = scenes.map((s) => s.name);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    void run(async () => {
      setScenes(await api.reorderScenes(order));
    });
  }

  async function openManage() {
    setError(null);
    try {
      await refreshScenes();
      setNewSceneName(randomName());
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

  // Give the session token back so the next visitor has to re-enter the password.
  async function lock() {
    try {
      await api.logout();
    } catch {
      // The token is being discarded either way.
    }
    signOut();
  }

  return (
    <Container size={'sm'} w={'100%'} py={'xl'}>
      <Title
        order={1}
        ta={'left'}
        style={{ position: 'fixed', top: 16, left: 16, right: 0, zIndex: 100 }}
      >
        C-Lux
      </Title>
      <Group gap={'xs'} style={{ position: 'fixed', top: 16, right: 16, zIndex: 100 }}>
        {authRequired() && (
          <Button variant={'default'} onClick={() => void lock()}>
            Lock
          </Button>
        )}
        <Button component={Link} to={'/'} variant={'default'}>
          Home
        </Button>
      </Group>
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
            Manage scenes
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
            onToggleEnabled={handleToggleEnabled}
            onRemove={handleRemove}
          />
        )}

        {patterns.some((p) => p.type === AUDIO_TYPE && p.enabled) && <AudioCapture />}
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

      <ManageScenesModal
        opened={manageOpen}
        onClose={() => setManageOpen(false)}
        scenes={scenes}
        patternCount={patterns.length}
        busy={busy}
        newSceneName={newSceneName}
        onNewSceneNameChange={setNewSceneName}
        onSave={handleSaveScene}
        onApply={handleApplyScene}
        onRename={handleRenameScene}
        onMove={moveScene}
        onDelete={handleDeleteScene}
        onExport={handleExportScene}
        onImport={handleImportScene}
      />
    </Container>
  );
}

export default Editor;
