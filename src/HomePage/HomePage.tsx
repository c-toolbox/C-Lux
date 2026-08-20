import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Checkbox,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { api, type PatternParameters, type StoredPatternSet } from '../lib/api';
import { PatternVisualizer } from '../PatternVisualizer/PatternVisualizer';

export function HomePage() {
  const [stored, setStored] = useState<StoredPatternSet[]>([]);
  const [active, setActive] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [halfLight, setHalfLight] = useState(false);

  const activeNames = new Set(active);

  // A set counts as enabled once every pattern it holds is running.
  const isEnabled = (set: StoredPatternSet) =>
    set.patterns.length > 0 && set.patterns.every((p) => activeNames.has(p.name));

  async function refresh() {
    try {
      const [sets, patterns, { paused }, { blackout }, { halfLight }] = await Promise.all(
        [
          api.storedPatterns(),
          api.listPatterns(),
          api.serverPaused(),
          api.blackout(),
          api.halfLight()
        ]
      );
      setStored(sets);
      setActive(patterns.map((p) => p.name));
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

  // Replace the active patterns with the chosen stored set.
  async function select(set: StoredPatternSet) {
    setBusy(true);
    try {
      setActive(names(await api.replaceWithStoredPatterns(set.name)));
      notifications.show({
        color: 'green',
        title: 'Pattern selected',
        message: `Now showing “${set.name}”.`
      });
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  // Add or remove a single stored set without touching the others.
  async function toggle(set: StoredPatternSet, enabled: boolean) {
    setBusy(true);
    try {
      setActive(
        names(
          enabled
            ? await api.addStoredPatterns(set.name)
            : await api.removeStoredPatterns(set.name)
        )
      );
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
        ) : stored.length === 0 ? (
          <Text c={'dimmed'} ta={'center'} py={'xl'}>
            No stored patterns yet. Create and store some in the editor.
          </Text>
        ) : (
          <Stack gap={'sm'}>
            {stored.map((set) => (
              <Group
                key={set.name}
                justify={'space-between'}
                p={'md'}
                style={{
                  border: '1px solid var(--mantine-color-default-border)',
                  borderRadius: 8
                }}
              >
                <Checkbox
                  checked={isEnabled(set)}
                  disabled={busy || set.patterns.length === 0}
                  onChange={(e) => void toggle(set, e.currentTarget.checked)}
                  label={<Text fw={600}>{set.name}</Text>}
                />

                <Group gap={'xs'}>
                  <Button disabled={busy} onClick={() => void select(set)}>
                    Select
                  </Button>
                </Group>
              </Group>
            ))}
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
