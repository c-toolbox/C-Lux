import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Checkbox,
  ColorInput,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import {
  api,
  type PatternParameters,
  type Scene,
  type SolidColorStatus,
  type SolidColorUpdate
} from '../lib/api';
import { hexToRgb, rgbToHex } from '../lib/color';
import { describeError } from '../lib/errors';
import { PatternVisualizer } from '../PatternVisualizer/PatternVisualizer';

// Mantine swaps the button variant when a toggle flips, so ease the resulting colors.
const toggleTransition = {
  transition: 'background-color 300ms ease, border-color 300ms ease, color 300ms ease'
};

export function HomePage() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [active, setActive] = useState<string[]>([]);
  // The fixed solid color scene, which lives outside the pattern list and is listed
  // alongside the saved scenes. `solidHex` follows the picker while it is being dragged.
  const [solid, setSolid] = useState<SolidColorStatus | null>(null);
  const [solidHex, setSolidHex] = useState('#000000');
  // The picker dropdown is controlled so that clicking the input can also close it again.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [halfLight, setHalfLight] = useState(false);

  const activeNames = new Set(active);

  // A scene counts as applied once every pattern it holds is running.
  const isApplied = (scene: Scene) =>
    scene.patterns.length > 0 && scene.patterns.every((p) => activeNames.has(p.name));

  function trackSolid(status: SolidColorStatus) {
    setSolid(status);
    setSolidHex(rgbToHex(status.target));
  }

  async function refresh() {
    try {
      const [sceneList, patterns, solidColor, { blackout }, { halfLight }] =
        await Promise.all([
          api.listScenes(),
          api.listPatterns(),
          api.solidColor(),
          api.blackout(),
          api.halfLight()
        ]);
      setScenes(sceneList);
      setActive(names(patterns));
      trackSolid(solidColor);
      setBlackout(blackout);
      setHalfLight(halfLight);
    } catch (e) {
      showError(e);
    }
  }

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, []);

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

  // Replace the active patterns with the chosen scene, so it is all that is left showing.
  async function select(scene: Scene) {
    setBusy(true);
    try {
      setActive(names(await api.replaceWithScene(scene.name)));
      trackSolid(await api.setSolidColor({ enabled: false }));
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
      setActive(
        names(
          applied ? await api.applyScene(scene.name) : await api.unapplyScene(scene.name)
        )
      );
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  // Switch the solid color scene on or off, or fade it to a new color.
  async function updateSolid(update: SolidColorUpdate) {
    setBusy(true);
    try {
      trackSolid(await api.setSolidColor(update));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  // The solid color equivalent of selecting a scene: drop every pattern and switch the
  // color on, so it is all that is left showing.
  async function selectSolid() {
    setBusy(true);
    try {
      setActive(names(await api.clearPatterns()));
      trackSolid(await api.setSolidColor({ enabled: true }));
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
    <Container fluid w={'100%'} px={'5%'} py={'xl'}>
      <Group justify={'space-between'} align={'center'} gap={'xs'}>
        <Title order={1} ta={'left'}>
          C-Lux
        </Title>
        <Button component={Link} to={'/editor'} variant={'default'}>
          Open editor
        </Button>
      </Group>
      <Stack mt={'md'}>
        <Group gap={'xs'} grow>
          <Button
            disabled={busy}
            onClick={() => void toggleBlackout()}
            variant={blackout ? 'filled' : 'default'}
            color={blackout ? '#2c5c00' : undefined}
            px={'xs'}
            style={toggleTransition}
          >
            {blackout ? 'Restore' : 'Fade to black'}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void toggleHalfLight()}
            variant={halfLight ? 'filled' : 'default'}
            color={halfLight ? '#a5145b' : undefined}
            px={'xs'}
            style={toggleTransition}
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
                  onChange={(e) => void updateSolid({ enabled: e.currentTarget.checked })}
                  label={<Text fw={600}>Solid color</Text>}
                />

                <Group gap={'xs'}>
                  <ColorInput
                    format={'hex'}
                    value={solidHex}
                    onChange={setSolidHex}
                    onChangeEnd={(hex) => void updateSolid({ color: hexToRgb(hex) })}
                    disabled={busy}
                    w={130}
                    aria-label={'Solid color'}
                    onClick={() => setPickerOpen((open) => !open)}
                    popoverProps={{
                      opened: pickerOpen,
                      onDismiss: () => setPickerOpen(false)
                    }}
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
