import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Container,
  Group,
  Loader,
  PasswordInput,
  Stack,
  Text,
  Title
} from '@mantine/core';

import { api } from '../lib/api';
import { editorToken, onSignedOut, setEditorToken } from '../lib/auth';

import { describeError } from './utils';

// Renders its children only once the editor password has been accepted. The gate is a
// convenience, not the protection itself: the endpoints the editor drives are guarded
// server-side, so a user who skips this screen still can't change anything.
export function PasswordGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(editorToken() !== null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock again as soon as the server turns a request down, so an expired token doesn't
  // leave the editor showing controls that no longer work.
  useEffect(() => onSignedOut(() => setUnlocked(false)), []);

  // A token kept from an earlier visit may have expired or been dropped by a restart.
  useEffect(() => {
    if (editorToken() === null) return;
    void api
      .authStatus()
      .then(({ authenticated }) => {
        if (authenticated) setUnlocked(true);
        else setEditorToken(null);
      })
      .catch(() => setEditorToken(null))
      .finally(() => setChecking(false));
  }, []);

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.login(password);
      setEditorToken(token);
      setPassword('');
      setUnlocked(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (unlocked) return <>{children}</>;

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
        to={'/'}
        variant={'default'}
        style={{ position: 'fixed', top: 16, right: 16, zIndex: 100 }}
      >
        Home
      </Button>

      {checking ? (
        <Group justify={'center'} py={'xl'}>
          <Loader />
        </Group>
      ) : (
        <Stack mt={'xl'} maw={360} mx={'auto'}>
          <Title order={2}>Editor locked</Title>
          <Text c={'dimmed'} size={'sm'}>
            Enter the editor password to change patterns and scenes.
          </Text>

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

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <Stack>
              <PasswordInput
                label={'Password'}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                autoFocus
                autoComplete={'current-password'}
                disabled={busy}
              />
              <Button type={'submit'} loading={busy} disabled={password === ''}>
                Unlock
              </Button>
            </Stack>
          </form>
        </Stack>
      )}
    </Container>
  );
}
