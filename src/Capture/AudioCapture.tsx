import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Group, NativeSelect, Paper, Progress, Stack, Text } from '@mantine/core';

import {
  type AudioCaptureHandle,
  type AudioSource,
  startAudioCapture
} from '../lib/audio';
import { describeError } from '../lib/errors';

const SOURCES = [
  { value: 'system', label: 'System audio' },
  { value: 'input', label: 'Input device' }
];

// Feeds the Audio pattern: patterns run on the server, which has no access to the sound
// card, so this tab captures it and streams the analysis over the API.
export function AudioCapture() {
  const [source, setSource] = useState<AudioSource>('system');
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<AudioCaptureHandle | null>(null);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setCapturing(false);
    setLevel(0);
  }, []);

  useEffect(() => stop, [stop]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      handle.current = await startAudioCapture({
        source,
        onLevel: setLevel,
        onEnded: stop
      });
      setCapturing(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Paper withBorder p={'sm'} radius={'md'}>
      <Stack gap={'xs'}>
        <Group grow align={'flex-end'}>
          <NativeSelect
            label={'Audio input'}
            description={
              source === 'system'
                ? 'Pick a screen or tab and enable "Share system audio"'
                : 'Records a line-in, microphone or loopback device'
            }
            value={source}
            data={SOURCES}
            disabled={capturing || starting}
            onChange={(e) => setSource(e.currentTarget.value as AudioSource)}
          />
          <Button
            variant={capturing ? 'filled' : 'default'}
            color={capturing ? 'green' : undefined}
            loading={starting}
            onClick={() => (capturing ? stop() : void start())}
          >
            {capturing ? 'Stop capture' : 'Start capture'}
          </Button>
        </Group>

        {capturing && <Progress value={level * 100} size={'sm'} transitionDuration={0} />}

        {error && (
          <Text c={'red'} size={'sm'}>
            {error}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
