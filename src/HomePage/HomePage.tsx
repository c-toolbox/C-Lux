import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  ColorSwatch,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title
} from '@mantine/core';

import { api, type StoredPatternSet } from '../lib/api';
import { rgbToHex } from '../lib/color';
import { PatternVisualizer } from '../PatternVisualizer/PatternVisualizer';

export function HomePage() {
  const [stored, setStored] = useState<StoredPatternSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setStored(await api.storedPatterns());
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  // Replace the active patterns with the chosen stored set.
  async function select(set: StoredPatternSet) {
    setBusy(true);
    setError(null);
    try {
      const current = await api.listPatterns();
      for (const p of current) {
        await api.removePattern(p.name);
      }
      await api.addStoredPatterns(set.name);
      setSelected(set.name);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container size={'sm'} py={'xl'}>
      <Stack gap={'lg'}>
        <Group justify={'space-between'} align={'center'}>
          <div>
            <Title order={1}>C-Lux</Title>
            <Text c={'dimmed'}>Select a stored pattern</Text>
          </div>
          <Button component={Link} to={'/editor'} variant={'default'}>
            Open editor
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

        {selected && (
          <Alert
            color={'green'}
            title={'Pattern selected'}
            withCloseButton
            onClose={() => setSelected(null)}
          >
            Now showing “{selected}”.
          </Alert>
        )}

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

                <Button disabled={busy} onClick={() => select(set)}>
                  Select
                </Button>
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
