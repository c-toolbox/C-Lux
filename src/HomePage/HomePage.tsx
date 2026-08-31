import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Box,
  Button,
  Checkbox,
  ColorInput,
  Container,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Title
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import {
  api,
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
  const [applied, setApplied] = useState<string[]>([]);
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

  const appliedNames = new Set(applied);

  const isApplied = (scene: Scene) => appliedNames.has(scene.name);

  function trackSolid(status: SolidColorStatus) {
    setSolid(status);
    setSolidHex(rgbToHex(status.target));
  }

  async function refresh() {
    try {
      const [sceneList, appliedList, solidColor, { blackout }, { halfLight }] =
        await Promise.all([
          api.listScenes(),
          api.appliedScenes(),
          api.solidColor(),
          api.blackout(),
          api.halfLight()
        ]);
      setScenes(sceneList);
      setApplied(appliedList);
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
      setApplied(await api.replaceWithScene(scene.name));
      trackSolid(await api.setSolidColor({ enabled: false }));
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
      setApplied(
        applied ? await api.applyScene(scene.name) : await api.unapplyScene(scene.name)
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
      await api.clearPatterns();
      setApplied([]);
      trackSolid(await api.setSolidColor({ enabled: true }));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
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
        <Button component={Link} to={'/editor'} variant={'default'}>
          Open editor
        </Button>
      </Group>
      <Stack mt={'md'} style={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <Group justify={'center'} py={'xl'}>
            <Loader />
          </Group>
        ) : (
          <ScrollArea type={'auto'} offsetScrollbars style={{ flex: 1, minHeight: 0 }}>
            <Stack gap={'xs'}>
              {solid && (
                <Group
                  justify={'space-between'}
                  px={'md'}
                  py={'xs'}
                  style={{
                    border: '1px solid var(--mantine-color-default-border)',
                    borderRadius: 8
                  }}
                >
                  <Checkbox
                    checked={solid.enabled}
                    disabled={busy}
                    onChange={(e) =>
                      void updateSolid({ enabled: e.currentTarget.checked })
                    }
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
                    px={'md'}
                    py={'xs'}
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
          </ScrollArea>
        )}
      </Stack>

      <Group
        mt={'md'}
        gap={64}
        justify={'center'}
        align={'center'}
        wrap={'nowrap'}
        style={{ flexShrink: 0 }}
      >
        <Button
          disabled={busy}
          onClick={() => void toggleBlackout()}
          variant={blackout ? 'filled' : 'default'}
          color={blackout ? '#2c5c00' : undefined}
          size={'lg'}
          h={140}
          px={'xs'}
          style={{
            ...toggleTransition,
            flex: '0 1 175px',
            whiteSpace: 'normal'
          }}
        >
          {blackout ? 'Restore' : 'Fade to black'}
        </Button>

        <Box style={{ flex: '0 1 350px' }}>
          <PatternVisualizer />
        </Box>

        <Button
          disabled={busy}
          onClick={() => void toggleHalfLight()}
          variant={halfLight ? 'filled' : 'default'}
          color={halfLight ? '#a5145b' : undefined}
          size={'lg'}
          h={140}
          px={'xs'}
          style={{
            ...toggleTransition,
            flex: '0 1 175px',
            whiteSpace: 'normal'
          }}
        >
          {halfLight ? 'Full lights' : 'Half light'}
        </Button>
      </Group>
    </Container>
  );
}

function showError(e: unknown): void {
  notifications.show({
    color: 'red',
    title: 'Error',
    message: describeError(e)
  });
}
