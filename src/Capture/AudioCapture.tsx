import { useCallback, useEffect, useRef, useState } from 'react';
import { TbMicrophone, TbPlayerStop } from 'react-icons/tb';
import { Button, Group, NativeSelect, Paper, Progress, Stack, Text } from '@mantine/core';

import {
  api,
  AUDIO_INPUT_DEVICE,
  AUDIO_INPUT_SYSTEM,
  type AudioParameters,
  type PatternParameters
} from '../lib/api';
import {
  type AudioCaptureHandle,
  type AudioSource,
  startAudioCapture
} from '../lib/audio';
import { describeError } from '../lib/errors';

const SOURCES = [
  { value: String(AUDIO_INPUT_SYSTEM), label: 'System audio' },
  { value: String(AUDIO_INPUT_DEVICE), label: 'Input device' }
];

interface AudioCaptureProps {
  // The Audio pattern the capture feeds; its `input` says what to record.
  pattern: AudioParameters;
  // Whether the panel may change the pattern, which needs the edit password.
  editable?: boolean;
  // Shown inside the pattern's own row, which already frames and names it.
  embedded?: boolean;
  // Called with the pattern after the panel changed it.
  onChange?: (pattern: PatternParameters) => void;
}

// Feeds the Audio pattern: patterns run on the server, which has no access to the sound
// card, so this tab captures it and streams the analysis over the API.
export function AudioCapture({
  pattern,
  editable = false,
  embedded = false,
  onChange
}: AudioCaptureProps) {
  const { input } = pattern;
  const source: AudioSource = input === AUDIO_INPUT_DEVICE ? 'input' : 'system';
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

  // Also stops a capture of the old source once the pattern asks for another one.
  useEffect(() => stop, [source, stop]);

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

  async function setInput(next: number) {
    setError(null);
    try {
      onChange?.(await api.updatePattern(pattern.name, { input: next }));
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <Paper withBorder={!embedded} p={embedded ? 0 : 'sm'} radius={'md'}>
      <Stack gap={'xs'}>
        <Group grow align={'flex-end'}>
          <NativeSelect
            label={embedded ? 'Audio input' : `Audio input for “${pattern.name}”`}
            description={
              source === 'system'
                ? 'Pick a screen or tab and enable "Share system audio"'
                : 'Records a line-in, microphone or loopback device'
            }
            value={String(input)}
            data={SOURCES}
            disabled={!editable || capturing || starting}
            onChange={(e) => void setInput(Number(e.currentTarget.value))}
          />
          <Button
            variant={capturing ? 'filled' : 'default'}
            color={capturing ? 'green' : undefined}
            loading={starting}
            leftSection={capturing ? <TbPlayerStop /> : <TbMicrophone />}
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
