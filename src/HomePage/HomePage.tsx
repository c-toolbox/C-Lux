import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Checkbox,
  ColorSwatch,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { api, type PatternParameters, type Scene, SOLID_COLOR_NAME } from '../lib/api';
import { patternSwatchHex } from '../lib/color';
import { PatternVisualizer } from '../PatternVisualizer/PatternVisualizer';

export function HomePage() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [active, setActive] = useState<string[]>([]);
  // The hardcoded solid color layer, listed alongside the scenes so it can be switched
  // off without opening the editor.
  const [solid, setSolid] = useState<PatternParameters | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [halfLight, setHalfLight] = useState(false);

  const activeNames = new Set(active);

  // A scene counts as applied once every pattern it holds is running.
  const isApplied = (scene: Scene) =>
    scene.patterns.length > 0 && scene.patterns.every((p) => activeNames.has(p.name));

  function trackPatterns(patterns: PatternParameters[]) {
    setActive(names(patterns));
    setSolid(patterns.find((p) => p.name === SOLID_COLOR_NAME) ?? null);
  }

  async function refresh() {
    try {
      const [sceneList, patterns, { paused }, { blackout }, { halfLight }] =
        await Promise.all([
          api.listScenes(),
          api.listPatterns(),
          api.serverPaused(),
          api.blackout(),
          api.halfLight()
        ]);
      setScenes(sceneList);
      trackPatterns(patterns);
      setPaused(paused);
      setBlackout(blackout);
      setHalfLight(halfLight);
    } catch (e) {
      showError(e);
    }
  }

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, []);

  // Pause or resume all pattern output on the server.
  async function togglePaused() {
    setBusy(true);
    try {
      const { paused: next } = await api.setServerPaused(!paused);
      setPaused(next);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  // Fade the output to black or restore it.
  async function toggleBlackout() {
    setBusy(true);
    try {
      const { blackout: next } = await api.setBlackout(!blackout);
      setBlackout(next);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  // Black out the top half of the ring or bring it back.
  async function toggleHalfLight() {
    setBusy(true);
    try {
      const { halfLight: next } = await api.setHalfLight(!halfLight);
      setHalfLight(next);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  // Replace the active patterns with the chosen scene.
  async function select(scene: Scene) {
    setBusy(true);
    try {
      trackPatterns(await api.replaceWithScene(scene.name));
      notifications.show({
        color: 'green',
        title: 'Scene selected',
        message: `Now showing “${scene.name}”.`
      });
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  // Apply or unapply a single scene without touching the others.
  async function toggle(scene: Scene, applied: boolean) {
    setBusy(true);
    try {
      trackPatterns(
        applied ? await api.applyScene(scene.name) : await api.unapplyScene(scene.name)
      );
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  // The solid color layer can't be removed, so switching it off means disabling it.
  async function toggleSolid(enabled: boolean) {
    setBusy(true);
    try {
      setSolid(await api.setPatternEnabled(SOLID_COLOR_NAME, enabled));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  // The solid color equivalent of selecting a scene: drop everything else and make sure
  // the layer itself is on.
  async function selectSolid() {
    setBusy(true);
    try {
      await api.clearPatterns();
      trackPatterns([await api.setPatternEnabled(SOLID_COLOR_NAME, true)]);
      notifications.show({
        color: 'green',
        title: 'Scene selected',
        message: 'Now showing “Solid color”.'
      });
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
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
      <Button
        component={Link}
        to={'/editor'}
        variant={'default'}
        style={{ position: 'fixed', top: 16, right: 16, zIndex: 100 }}
      >
        Open editor
      </Button>
      <Stack mt={'xl'}>
        <Group gap={'xs'} grow>
          <Button
            disabled={busy}
            onClick={() => void togglePaused()}
            variant={paused ? 'filled' : 'default'}
            color={paused ? 'orange' : undefined}
            px={'xs'}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void toggleBlackout()}
            variant={blackout ? 'filled' : 'default'}
            color={blackout ? 'blue' : undefined}
            px={'xs'}
          >
            {blackout ? 'Restore' : 'Fade to black'}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void toggleHalfLight()}
            variant={halfLight ? 'filled' : 'default'}
            color={halfLight ? 'grape' : undefined}
            px={'xs'}
          >
            {halfLight ? 'Full lights' : 'Half light'}
          </Button>
        </Group>

        {loading ? (
          <Group justify={'center'} py={'xl'}>
            <Loader />
          </Group>
        ) : (
          <Stack gap={'sm'}>
            {solid && (
              <Group
                justify={'space-between'}
                p={'md'}
                style={{
                  border: '1px solid var(--mantine-color-default-border)',
                  borderRadius: 8
                }}
              >
                <Checkbox
                  checked={solid.enabled}
                  disabled={busy}
                  onChange={(e) => void toggleSolid(e.currentTarget.checked)}
                  label={<Text fw={600}>Solid color</Text>}
                />

                <Group gap={'xs'}>
                  <ColorSwatch
                    color={patternSwatchHex(solid)}
                    opacity={solid.enabled ? 1 : 0.4}
                  />
                  <Button disabled={busy} onClick={() => void selectSolid()}>
                    Select
                  </Button>
                </Group>
              </Group>
            )}

            {scenes.length === 0 ? (
              <Text c={'dimmed'} ta={'center'} py={'xl'}>
                No scenes yet. Create and save some in the editor.
              </Text>
            ) : (
              scenes.map((scene) => (
                <Group
                  key={scene.name}
                  justify={'space-between'}
                  p={'md'}
                  style={{
                    border: '1px solid var(--mantine-color-default-border)',
                    borderRadius: 8
                  }}
                >
                  <Checkbox
                    checked={isApplied(scene)}
                    disabled={busy || scene.patterns.length === 0}
                    onChange={(e) => void toggle(scene, e.currentTarget.checked)}
                    label={<Text fw={600}>{scene.name}</Text>}
                  />

                  <Group gap={'xs'}>
                    <Button disabled={busy} onClick={() => void select(scene)}>
                      Select
                    </Button>
                  </Group>
                </Group>
              ))
            )}
          </Stack>
        )}

        <PatternVisualizer />
      </Stack>
    </Container>
  );
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function names(patterns: PatternParameters[]): string[] {
  return patterns.map((p) => p.name);
}

function showError(e: unknown): void {
  notifications.show({
    color: 'red',
    title: 'Error',
    message: describeError(e)
  });
}
