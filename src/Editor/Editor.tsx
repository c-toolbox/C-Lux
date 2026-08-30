import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Container,
  FileButton,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title
} from '@mantine/core';

import { api, AUDIO_TYPE, type PatternParameters, type Scene } from '../lib/api';
import { authRequired, signOut } from '../lib/auth';
import { describeError } from '../lib/errors';
import { type FormValues, toProps } from '../PatternForm/PatternForm';
import { PatternVisualizer } from '../PatternVisualizer/PatternVisualizer';

import { AddPatternModal } from './AddPatternModal';
import { AudioCapture } from './AudioCapture';
import { EditPatternModal } from './EditPatternModal';
import { ManageScenesModal } from './ManageScenesModal';
import { PatternList } from './PatternList';
import { downloadJson, randomName, readJsonFile } from './utils';

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
  const [newSceneName, setNewSceneName] = useState(randomName());
  // The scene the pattern list was loaded from, if the user is editing one in place.
  const [editingScene, setEditingScene] = useState<string | null>(null);
  const resetFile = useRef<() => void>(null);

  async function refresh() {
    try {
      setPatterns(await api.listPatterns());
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

  // Load a scene's patterns as the working list so it can be changed and saved back.
  function handleEditScene(scene: Scene) {
    void run(async () => {
      await api.replaceWithScene(scene.name);
      setEditingScene(scene.name);
      setManageOpen(false);
    });
  }

  function handleUpdateScene(name: string) {
    void run(async () => {
      await api.saveScene(name);
      await refreshScenes();
      setEditingScene(null);
    });
  }

  function handleDeleteScene(name: string) {
    void run(async () => {
      await api.deleteScene(name);
      await refreshScenes();
      if (editingScene === name) setEditingScene(null);
    });
  }

  function handleRenameScene(name: string, newName: string) {
    void run(async () => {
      await api.renameScene(name, newName);
      await refreshScenes();
      if (editingScene === name) setEditingScene(newName);
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
    <Container
      fluid
      w={'100%'}
      px={'5%'}
      py={'xl'}
      h={'100svh'}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <Group justify={'space-between'} align={'center'} gap={'xs'}>
        <Title order={1} ta={'left'}>
          C-Lux
        </Title>
        <Group gap={'xs'}>
          {authRequired() && (
            <Button variant={'default'} onClick={() => void lock()}>
              Lock
            </Button>
          )}
          <Button component={Link} to={'/'} variant={'default'}>
            Home
          </Button>
        </Group>
      </Group>
      <Stack mt={'md'} style={{ flex: 1, minHeight: 0 }}>
        <Group align={'flex-end'} gap={'xs'}>
          <TextInput
            placeholder={'Name'}
            value={newSceneName}
            disabled={busy}
            onChange={(e) => setNewSceneName(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Button
            disabled={busy || patterns.length === 0 || newSceneName.trim() === ''}
            onClick={() => handleSaveScene(newSceneName.trim())}
          >
            Save patterns as scene
          </Button>
          <FileButton
            resetRef={resetFile}
            accept={'application/json,.json'}
            onChange={(file) => {
              if (!file) return;
              handleImportScene(file);
              // Clear the input so picking the same file again still fires onChange.
              resetFile.current?.();
            }}
          >
            {(props) => (
              <Button {...props} variant={'default'} disabled={busy}>
                Import scene…
              </Button>
            )}
          </FileButton>
          <Button variant={'default'} onClick={() => void openManage()}>
            Manage scenes
          </Button>
        </Group>

        <Group grow>
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

        {editingScene !== null && (
          <Alert color={'blue'} title={`Editing scene “${editingScene}”`}>
            <Group justify={'space-between'} gap={'xs'}>
              <Text size={'sm'}>Saving overwrites it with the patterns below.</Text>
              <Group gap={'xs'}>
                <Button
                  size={'xs'}
                  variant={'default'}
                  disabled={busy}
                  onClick={() => setEditingScene(null)}
                >
                  Stop editing
                </Button>
                <Button
                  size={'xs'}
                  disabled={busy || patterns.length === 0}
                  onClick={() => handleUpdateScene(editingScene)}
                >
                  Save changes
                </Button>
              </Group>
            </Group>
          </Alert>
        )}

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

        <ScrollArea type={'auto'} offsetScrollbars style={{ flex: 1, minHeight: 0 }}>
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
        </ScrollArea>

        {patterns.some((p) => p.type === AUDIO_TYPE && p.enabled) && <AudioCapture />}
      </Stack>

      <Box mt={'md'} style={{ flexShrink: 0 }}>
        <PatternVisualizer />
      </Box>

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
        busy={busy}
        onSubmit={(values) => void handleEdit(values)}
      />

      <ManageScenesModal
        opened={manageOpen}
        onClose={() => setManageOpen(false)}
        scenes={scenes}
        busy={busy}
        editing={editingScene}
        onApply={handleApplyScene}
        onEdit={handleEditScene}
        onRename={handleRenameScene}
        onMove={moveScene}
        onDelete={handleDeleteScene}
        onExport={handleExportScene}
      />
    </Container>
  );
}

export default Editor;
