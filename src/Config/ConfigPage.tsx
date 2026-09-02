import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Container,
  Fieldset,
  Group,
  Loader,
  NumberInput,
  PasswordInput,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import {
  api,
  type ArtNetSettings,
  type OutputSettings,
  type ServerSettings,
  type Settings
} from '../lib/api';
import { signOut } from '../lib/auth';
import { describeError } from '../lib/errors';

// The remap is edited as JSON: it is a sparse map of light indices, and a table for 142
// lights would be far more unwieldy than the handful of entries it ever holds.
function formatRemap(remap: Record<string, number>): string {
  const entries = Object.entries(remap).sort(([a], [b]) => Number(a) - Number(b));
  return entries.length === 0
    ? '{}'
    : `{\n${entries.map(([from, to]) => `  "${from}": ${to}`).join(',\n')}\n}`;
}

function parseRemap(text: string): Record<string, number> {
  const parsed: unknown = JSON.parse(text.trim() === '' ? '{}' : text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('must be a JSON object, for example { "5": 3, "3": 5 }');
  }

  const remap: Record<string, number> = {};
  for (const [from, to] of Object.entries(parsed)) {
    if (!/^\d+$/.test(from)) throw new Error(`"${from}" is not a light index`);
    if (typeof to !== 'number' || !Number.isInteger(to) || to < 0) {
      throw new Error(`"${from}" must point at a light index`);
    }
    remap[from] = to;
  }
  return remap;
}

// Mantine hands back the raw text while a number field is being typed into; anything that
// isn't a number yet leaves the setting on its last good value.
function NumberField({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
  disabled
}: {
  label: string;
  description?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <NumberInput
      label={label}
      description={description}
      value={value}
      onChange={(next) => {
        if (typeof next === 'number' && Number.isFinite(next)) onChange(next);
      }}
      min={min}
      max={max}
      step={step}
      clampBehavior={'strict'}
      disabled={disabled}
    />
  );
}

// Every setting in config.json, behind the editor password. Changes are only sent when
// Save is pressed; the server then rewrites config.json and picks up what it reads live,
// reporting back the settings that have to wait for a restart.
export function ConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // What the server last told us it has, so Save can be offered only when something
  // actually changed and Revert has something to go back to.
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [passwordSet, setPasswordSet] = useState(false);
  // null while the password is being left alone; a string once the user types one.
  const [password, setPassword] = useState<string | null>(null);
  const [remapText, setRemapText] = useState('{}');
  const [remapError, setRemapError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState<string[]>([]);

  function adopt(settings: Settings, editPasswordSet: boolean) {
    setSaved(settings);
    setDraft(settings);
    setPasswordSet(editPasswordSet);
    setPassword(null);
    setRemapText(formatRemap(settings.output.remap));
    setRemapError(null);
  }

  useEffect(() => {
    void api
      .config()
      .then((status) => adopt(status.settings, status.editPasswordSet))
      .catch((e: unknown) => setError(describeError(e)))
      .finally(() => setLoading(false));
  }, []);

  function patchServer<K extends keyof ServerSettings>(key: K, value: ServerSettings[K]) {
    setDraft((d) => (d === null ? d : { ...d, server: { ...d.server, [key]: value } }));
  }

  function patchOutput<K extends keyof OutputSettings>(key: K, value: OutputSettings[K]) {
    setDraft((d) => (d === null ? d : { ...d, output: { ...d.output, [key]: value } }));
  }

  function patchArtnet<K extends keyof ArtNetSettings>(key: K, value: ArtNetSettings[K]) {
    setDraft((d) =>
      d === null
        ? d
        : { ...d, output: { ...d.output, artnet: { ...d.output.artnet, [key]: value } } }
    );
  }

  function changeRemap(text: string) {
    setRemapText(text);
    try {
      patchOutput('remap', parseRemap(text));
      setRemapError(null);
    } catch (e) {
      setRemapError(describeError(e));
    }
  }

  async function save() {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveConfig({
        settings: draft,
        ...(password === null ? {} : { editPassword: password })
      });
      adopt(result.settings, result.editPasswordSet);
      setRestartRequired(result.restartRequired);
      notifications.show({
        color: 'green',
        title: 'Saved',
        message: 'config.json written'
      });

      // The server drops every session when the password changes, so this tab's token is
      // no longer good for anything.
      if (password !== null) {
        notifications.show({
          color: 'yellow',
          title: 'Password changed',
          message: 'Unlock again with the new password.'
        });
        signOut();
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    draft !== null &&
    (password !== null || JSON.stringify(draft) !== JSON.stringify(saved));

  return (
    <Container fluid w={'100%'} px={'5%'} py={'xl'}>
      <Group justify={'space-between'} align={'center'} gap={'xs'}>
        <Title order={1} ta={'left'}>
          C-Lux config
        </Title>
        <Group gap={'xs'}>
          <Button component={Link} to={'/editor'} variant={'default'}>
            Editor
          </Button>
          <Button component={Link} to={'/'} variant={'default'}>
            Home
          </Button>
        </Group>
      </Group>

      {loading ? (
        <Group justify={'center'} py={'xl'}>
          <Loader />
        </Group>
      ) : (
        <Stack mt={'xl'} maw={560} mx={'auto'}>
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

          {restartRequired.length > 0 && (
            <Alert
              color={'yellow'}
              title={'Restart needed'}
              withCloseButton
              onClose={() => setRestartRequired([])}
            >
              Saved, but these are only read while the server starts, so the lights keep
              running on the old values until it is restarted:{' '}
              {restartRequired.join(', ')}.
            </Alert>
          )}

          {draft !== null && (
            <>
              <Fieldset legend={'Installation'}>
                <NumberField
                  label={'Lights'}
                  description={
                    'Number of lights on the ring. Takes effect after a restart, and ' +
                    'after rebuilding the web app, which bakes it in.'
                  }
                  value={draft.nLights}
                  onChange={(value) =>
                    setDraft((d) => (d === null ? d : { ...d, nLights: value }))
                  }
                  min={1}
                  step={1}
                />
              </Fieldset>

              <Fieldset legend={'Server'}>
                <Stack gap={'sm'}>
                  <NumberField
                    label={'Tick rate'}
                    description={
                      'Pattern updates per second. Takes effect after a restart.'
                    }
                    value={draft.server.tickRate}
                    onChange={(value) => patchServer('tickRate', value)}
                    min={1}
                  />
                  <NumberField
                    label={'Port'}
                    description={'Takes effect after a restart.'}
                    value={draft.server.port}
                    onChange={(value) => patchServer('port', value)}
                    min={1}
                    max={65535}
                    step={1}
                  />
                  <TextInput
                    label={'Scenes file'}
                    description={
                      'File name, relative to the project root. Takes effect after a ' +
                      'restart.'
                    }
                    value={draft.server.scenes}
                    onChange={(e) => patchServer('scenes', e.currentTarget.value)}
                  />
                  <PasswordInput
                    label={'Editor password'}
                    description={
                      passwordSet
                        ? 'Leave blank to keep the current password. Changing it signs ' +
                          'every editor out, including this one.'
                        : 'No password is set: the editor is open to anyone who can ' +
                          'reach the server.'
                    }
                    placeholder={passwordSet ? 'Unchanged' : 'No password'}
                    value={password ?? ''}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    autoComplete={'new-password'}
                  />
                  {password !== null && (
                    <Group gap={'xs'}>
                      <Button
                        size={'compact-sm'}
                        variant={'default'}
                        onClick={() => setPassword(null)}
                      >
                        Keep current password
                      </Button>
                      {password === '' && (
                        <Text c={'yellow'} size={'sm'}>
                          Saving an empty password removes the protection entirely.
                        </Text>
                      )}
                    </Group>
                  )}
                </Stack>
              </Fieldset>

              <Fieldset legend={'Transitions'}>
                <Stack gap={'sm'}>
                  <NumberField
                    label={'Blackout (s)'}
                    value={draft.server.blackoutTransition}
                    onChange={(value) => patchServer('blackoutTransition', value)}
                    min={0}
                    step={0.1}
                  />
                  <NumberField
                    label={'Half light (s)'}
                    value={draft.server.halfLightTransition}
                    onChange={(value) => patchServer('halfLightTransition', value)}
                    min={0}
                    step={0.1}
                  />
                  <NumberField
                    label={'Half light feather'}
                    description={'How soft the edge between the lit and dark halves is.'}
                    value={draft.server.halfLightFeather}
                    onChange={(value) => patchServer('halfLightFeather', value)}
                    min={0.01}
                    step={0.1}
                  />
                  <NumberField
                    label={'Solid color (s)'}
                    value={draft.server.solidColorTransition}
                    onChange={(value) => patchServer('solidColorTransition', value)}
                    min={0}
                    step={0.1}
                  />
                  <NumberField
                    label={'Scene (s)'}
                    description={'Cross-fade when a scene replaces another.'}
                    value={draft.server.sceneTransition}
                    onChange={(value) => patchServer('sceneTransition', value)}
                    min={0}
                    step={0.1}
                  />
                </Stack>
              </Fieldset>

              <Fieldset legend={'Output'}>
                <Stack gap={'sm'}>
                  <Text c={'dimmed'} size={'sm'}>
                    Applied on the way to the hardware, and only read while the server
                    starts: these take effect after a restart.
                  </Text>
                  <NumberField
                    label={'Rotation (°)'}
                    description={'Where light 0 of the frame sits on the installation.'}
                    value={draft.output.rotation}
                    onChange={(value) => patchOutput('rotation', value)}
                  />
                  <Textarea
                    label={'Remap'}
                    description={
                      'Lights patched to the wrong address, as { "from": to }. The ' +
                      'listed lights have to swap amongst themselves.'
                    }
                    value={remapText}
                    onChange={(e) => changeRemap(e.currentTarget.value)}
                    error={remapError}
                    autosize
                    minRows={3}
                    styles={{
                      input: { fontFamily: 'var(--mantine-font-family-monospace)' }
                    }}
                  />
                </Stack>
              </Fieldset>

              <Fieldset legend={'Art-Net'}>
                <Stack gap={'sm'}>
                  <Switch
                    checked={draft.output.artnet.enabled}
                    onChange={(e) => patchArtnet('enabled', e.currentTarget.checked)}
                    label={'Send frames over Art-Net'}
                  />
                  <TextInput
                    label={'Host'}
                    value={draft.output.artnet.host}
                    onChange={(e) => patchArtnet('host', e.currentTarget.value)}
                  />
                  <NumberField
                    label={'Port'}
                    value={draft.output.artnet.port}
                    onChange={(value) => patchArtnet('port', value)}
                    min={1}
                    max={65535}
                    step={1}
                  />
                  <Group grow align={'flex-start'}>
                    <NumberField
                      label={'Net'}
                      value={draft.output.artnet.net}
                      onChange={(value) => patchArtnet('net', value)}
                      min={0}
                      step={1}
                    />
                    <NumberField
                      label={'Subnet'}
                      value={draft.output.artnet.subnet}
                      onChange={(value) => patchArtnet('subnet', value)}
                      min={0}
                      step={1}
                    />
                    <NumberField
                      label={'Universe'}
                      value={draft.output.artnet.universe}
                      onChange={(value) => patchArtnet('universe', value)}
                      min={0}
                      step={1}
                    />
                  </Group>
                  <NumberField
                    label={'Start channel'}
                    value={draft.output.artnet.startChannel}
                    onChange={(value) => patchArtnet('startChannel', value)}
                    min={1}
                    step={1}
                  />
                  <NumberField
                    label={'End channel'}
                    description={'0 sends as many channels as the frame needs.'}
                    value={draft.output.artnet.endChannel}
                    onChange={(value) => patchArtnet('endChannel', value)}
                    min={0}
                    step={1}
                  />
                  <NumberField
                    label={'Universe size'}
                    value={draft.output.artnet.universeSize}
                    onChange={(value) => patchArtnet('universeSize', value)}
                    min={2}
                    max={512}
                    step={1}
                  />
                  <NumberField
                    label={'Refresh rate'}
                    description={'Packets per second.'}
                    value={draft.output.artnet.refreshRate}
                    onChange={(value) => patchArtnet('refreshRate', value)}
                    min={1}
                  />
                </Stack>
              </Fieldset>

              <Group justify={'flex-end'} gap={'xs'} pb={'xl'}>
                <Button
                  variant={'default'}
                  disabled={!dirty || saving}
                  onClick={() => saved !== null && adopt(saved, passwordSet)}
                >
                  Revert
                </Button>
                <Button
                  loading={saving}
                  disabled={!dirty || remapError !== null}
                  onClick={() => void save()}
                >
                  Save
                </Button>
              </Group>
            </>
          )}
        </Stack>
      )}
    </Container>
  );
}
