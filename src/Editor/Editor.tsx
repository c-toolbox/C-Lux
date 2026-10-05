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

import {
  api,
  type PatternParameters,
  type Scene,
  SCENE_EXPORT_VERSION,
  type Timeline,
  type TimelinePlayback
} from '../lib/api';
import { authRequired, signOut } from '../lib/auth';
import {
  DRAFT_CAPTURE,
  duplicateCapture,
  renameCapture,
  stopCapture,
  syncCaptures
} from '../lib/captures';
import { describeError } from '../lib/errors';
import { type FormValues, fromParameters, toProps } from '../PatternForm/PatternForm';
import { PatternVisualizer } from '../PatternVisualizer/PatternVisualizer';

import { AddPatternModal } from './AddPatternModal';
import { EditPatternModal } from './EditPatternModal';
import { ManageScenesModal } from './ManageScenesModal';
import { PatternList } from './PatternList';
import { type TimelineControl, TimelinePanel } from './TimelinePanel';
import { copyName, downloadJson, randomName, readJsonFile } from './utils';

// How often the timelines are re-read, so the playhead shown can't drift from the server's.
const TIMELINE_SYNC_MS = 5000;

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
  // The running timelines, and `performance.now()` when they were read.
  const [timelines, setTimelines] = useState<{ list: TimelinePlayback[]; at: number }>({
    list: [],
    at: 0
  });
  const resetFile = useRef<() => void>(null);

  const trackTimelines = useCallback((list: TimelinePlayback[]) => {
    setTimelines({ list, at: performance.now() });
  }, []);

  async function refresh() {
    try {
      const [patternList, timelineList] = await Promise.all([
        api.listPatterns(),
        api.timelines()
      ]);
      setPatterns(patternList);
      syncCaptures(patternList);
      setTimelines({ list: timelineList, at: performance.now() });
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
    // A scene selected on the home page (the only one lit) opens straight into editing it.
    Promise.all([api.appliedScenes(), api.solidColor()]).then(
      ([applied, solid]) => {
        if (applied.length === 1 && !solid.enabled) setEditingScene(applied[0]);
      },
      () => undefined
    );
  }, []);

  useEffect(() => {
    if (editingScene === null) return;
    const timer = setInterval(() => {
      api.timelines().then(trackTimelines, () => undefined);
    }, TIMELINE_SYNC_MS);
    return () => clearInterval(timer);
  }, [editingScene, trackTimelines]);

  const timed = new Set(timelines.list.flatMap((t) => Object.keys(t.timeline.tracks)));
  const editingPlayback = timelines.list.find((t) => t.scene === editingScene) ?? null;

  // Timeline edits skip `run`, so the inputs being typed into don't lose focus to `busy`.
  async function handleTimelineChange(timeline: Timeline) {
    if (editingScene === null) return;
    try {
      trackTimelines(await api.setTimeline(editingScene, timeline));
      // A pattern given a track is switched on, so the list has to catch up.
      const patternList = await api.listPatterns();
      setPatterns(patternList);
      syncCaptures(patternList);
    } catch (e) {
      setError(describeError(e));
      await refresh();
    }
  }

  async function handleTimelineControl(control: TimelineControl) {
    if (editingScene === null) return;
    try {
      trackTimelines(await api.controlTimeline(editingScene, control));
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function handleTimelineRemove() {
    if (editingScene === null) return;
    try {
      trackTimelines(await api.removeTimeline(editingScene));
    } catch (e) {
      setError(describeError(e));
    }
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
      const { name } = await api.addPattern(values.type, toProps(values));
      // The refresh after this stops it if the pattern turned out not to take a capture.
      renameCapture(DRAFT_CAPTURE, name);
      setAddOpen(false);
    });
  }

  async function handleEdit(name: string, values: FormValues, overwrite: boolean) {
    await run(async () => {
      const updated = await api.updatePattern(name, toProps(values), overwrite);
      renameCapture(name, updated.name);
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
      await duplicateCapture(pattern.name, name);
      await duplicateCapture(pattern.name, name);
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
        {/* Clipped rather than allowed to grow, so the list can never spill over the
          visualiser beside it; the scroller inside reaches whatever does not fit. */}
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
                  timed={timed}
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

      {editingScene !== null && (
        <ScrollArea.Autosize
          mah={'40svh'}
          mt={'md'}
          type={'auto'}
          scrollbars={'y'}
          offsetScrollbars
        >
          <TimelinePanel
            playback={editingPlayback}
            fetchedAt={timelines.at}
            patterns={existingNames}
            onChange={(timeline) => void handleTimelineChange(timeline)}
            onControl={(control) => void handleTimelineControl(control)}
            onRemove={() => void handleTimelineRemove()}
          />
        </ScrollArea.Autosize>
      )}

      <AddPatternModal
        opened={addOpen}
        onClose={() => {
          setAddOpen(false);
          stopCapture(DRAFT_CAPTURE);
        }}
        namePlaceholder={namePlaceholder}
        existingNames={existingNames}
        busy={busy}
        onSubmit={(values) => void handleAdd(values)}
      />

      <EditPatternModal
        editing={editing}
        existingNames={existingNames}
        onClose={() => {
          setEditing(null);
          // Captures were following the discarded values; aim them as saved again.
          syncCaptures(patterns);
        }}
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
