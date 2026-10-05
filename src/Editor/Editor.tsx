import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TbCheck,
  TbDeviceFloppy,
  TbFileImport,
  TbHome,
  TbListDetails,
  TbLock,
  TbPlus,
  TbSettings,
  TbX
} from 'react-icons/tb';
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

import { AudioCapture } from '../Capture/AudioCapture';
import { VideoCapture } from '../Capture/VideoCapture';
import {
  api,
  AUDIO_TYPE,
  type PatternParameters,
  type Scene,
  SCENE_EXPORT_VERSION,
  VIDEO_TYPE
} from '../lib/api';
import { authRequired, signOut } from '../lib/auth';
import { describeError } from '../lib/errors';
import { type FormValues, fromParameters, toProps } from '../PatternForm/PatternForm';
import { PatternVisualizer } from '../PatternVisualizer/PatternVisualizer';

import { AddPatternModal } from './AddPatternModal';
import { EditPatternModal } from './EditPatternModal';
import { ManageScenesModal } from './ManageScenesModal';
import { PatternList } from './PatternList';
import { copyName, downloadJson, randomName, readJsonFile } from './utils';

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

  // A capture panel changed its pattern; nothing else moved, so no full refresh.
  const replacePattern = useCallback((updated: PatternParameters) => {
    setPatterns((list) => list.map((p) => (p.name === updated.name ? updated : p)));
  }, []);

  // The capture controls live in the row of the pattern they feed; every enabled Audio
  // and Video pattern captures a feed of its own.
  function captureDetails(p: PatternParameters) {
    if (!p.enabled) return null;
    if (p.type === AUDIO_TYPE) {
      return <AudioCapture pattern={p} editable embedded onChange={replacePattern} />;
    }
    if (p.type === VIDEO_TYPE) {
      return <VideoCapture pattern={p} editable embedded onChange={replacePattern} />;
    }
    return null;
  }

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

  async function handleEdit(name: string, values: FormValues, overwrite: boolean) {
    await run(async () => {
      await api.updatePattern(name, toProps(values), overwrite);
      setEditing(null);
    });
  }

  // The copy lands right below the original, in the same enabled state.
  function handleDuplicate(pattern: PatternParameters) {
    const names = patterns.map((p) => p.name);
    const name = copyName(pattern.name, names);
    void run(async () => {
      await api.addPattern(pattern.type, toProps({ ...fromParameters(pattern), name }));
      const order = [...names];
      order.splice(names.indexOf(pattern.name) + 1, 0, name);
      await api.reorderPatterns(order);
      if (!pattern.enabled) await api.setPatternEnabled(name, false);
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

  function handleRenameScene(name: string, newName: string, overwrite: boolean) {
    void run(async () => {
      await api.renameScene(name, newName, overwrite);
      await refreshScenes();
      if (editingScene === name) setEditingScene(newName);
      else if (editingScene === newName) setEditingScene(null);
    });
  }

  function handleExportScene(scene: Scene) {
    setError(null);
    try {
      downloadJson(scene.name, { version: SCENE_EXPORT_VERSION, ...scene });
    } catch (e) {
      setError(describeError(e));
    }
  }

  // The copy lands right below the original.
  function handleDuplicateScene(scene: Scene) {
    const names = scenes.map((s) => s.name);
    const name = copyName(scene.name, names);
    void run(async () => {
      await api.importScene({ version: SCENE_EXPORT_VERSION, ...scene, name });
      const order = [...names];
      order.splice(names.indexOf(scene.name) + 1, 0, name);
      setScenes(await api.reorderScenes(order));
    });
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
      px={'2%'}
      py={'2%'}
      h={'100svh'}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <Group justify={'space-between'} align={'center'} gap={'xs'}>
        <Title order={1} ta={'left'}>
          C-Lux
        </Title>
        <Group gap={'xs'}>
          {authRequired() && (
            <Button
              variant={'default'}
              leftSection={<TbLock />}
              onClick={() => void lock()}
            >
              Lock
            </Button>
          )}
          <Button
            component={Link}
            to={'/config'}
            variant={'default'}
            leftSection={<TbSettings />}
          >
            Config
          </Button>
          <Button component={Link} to={'/'} variant={'default'} leftSection={<TbHome />}>
            Home
          </Button>
        </Group>
      </Group>
      <Stack mt={'md'} style={{ flexShrink: 0 }}>
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
            leftSection={<TbDeviceFloppy />}
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
              <Button
                {...props}
                variant={'default'}
                disabled={busy}
                leftSection={<TbFileImport />}
              >
                Import scene…
              </Button>
            )}
          </FileButton>
          <Button
            variant={'default'}
            leftSection={<TbListDetails />}
            onClick={() => void openManage()}
          >
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
            leftSection={<TbPlus />}
          >
            Add pattern
          </Button>
        </Group>

        {editingScene !== null && (
          <Alert color={'blue'} py={6} px={'sm'}>
            <Group justify={'space-between'} gap={'xs'} wrap={'nowrap'}>
              <Text size={'sm'} fw={500} truncate>
                Editing scene “{editingScene}”
              </Text>
              <Group gap={'xs'} wrap={'nowrap'}>
                <Button
                  size={'xs'}
                  variant={'default'}
                  disabled={busy}
                  leftSection={<TbX />}
                  onClick={() => setEditingScene(null)}
                >
                  Stop editing
                </Button>
                <Button
                  size={'xs'}
                  disabled={busy || patterns.length === 0}
                  leftSection={<TbCheck />}
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
      </Stack>

      <Group
        mt={'md'}
        gap={'md'}
        align={'stretch'}
        wrap={'nowrap'}
        style={{ flex: 1, minHeight: 0 }}
      >
        {/* Clipped rather than allowed to grow, so the capture widgets can never spill
          over the visualiser beside them; the scroller inside reaches whatever does not fit. */}
        <Stack style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          <ScrollArea type={'auto'} offsetScrollbars style={{ flex: 1, minHeight: 0 }}>
            <Stack gap={'md'}>
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
                  onDuplicate={handleDuplicate}
                  onToggleEnabled={handleToggleEnabled}
                  onRemove={handleRemove}
                  renderDetails={captureDetails}
                />
              )}
            </Stack>
          </ScrollArea>
        </Stack>

        {/* The square visualizer is capped by both the column width and the row height,
            so it can never grow taller than the space and overlap the controls above. */}
        <Box
          style={{
            flex: '1 1 0',
            minWidth: 0,
            minHeight: 0,
            containerType: 'size',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Box w={'min(100cqw, 100cqh)'}>
            <PatternVisualizer />
          </Box>
        </Box>
      </Group>

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
        existingNames={existingNames}
        onClose={() => setEditing(null)}
        busy={busy}
        onSubmit={(values, overwrite) =>
          editing && void handleEdit(editing.name, values, overwrite)
        }
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
        onDuplicate={handleDuplicateScene}
        onMove={moveScene}
        onDelete={handleDeleteScene}
        onExport={handleExportScene}
      />
    </Container>
  );
}

export default Editor;
