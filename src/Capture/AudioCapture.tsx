import { type ReactNode, useEffect, useState } from 'react';
import { TbMicrophone, TbPlayerStop } from 'react-icons/tb';
import { Button, Paper, Progress, Stack, Text } from '@mantine/core';

import { audioSourceOf, startAudio, stopCapture, useCapture } from '../lib/captures';
import { describeError } from '../lib/errors';

interface AudioCaptureProps {
  // The key of the capture: the pattern's saved name, or `DRAFT_CAPTURE` while adding it.
  pattern: string;
  // The source the dialog currently asks for.
  input: number;
  // The dialog's own inputs for the capture, shown at the top of the panel.
  controls: ReactNode;
}

// Feeds the Audio pattern: patterns run on the server, which has no access to the sound
// card, so this tab captures it and streams the analysis over the API.
export function AudioCapture({ pattern, input, controls }: AudioCaptureProps) {
  const source = audioSourceOf(input);
  const capture = useCapture(pattern);
  const running = capture?.kind === 'audio' ? capture : null;
  const [starting, setStarting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // A capture of another kind or source no longer records what the pattern asks for.
  useEffect(() => {
    if (capture && (capture.kind !== 'audio' || capture.source !== source)) {
      stopCapture(pattern);
    }
  }, [capture, source, pattern]);

  useEffect(() => {
    if (!running) return;
    running.levels.add(setLevel);
    return () => {
      running.levels.delete(setLevel);
      setLevel(0);
    };
  }, [running]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await startAudio(pattern, source);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Paper withBorder p={'sm'} radius={'md'}>
      <Stack gap={'xs'}>
        {controls}

        <Text size={'sm'} c={'dimmed'}>
          {source === 'system'
            ? 'Pick a screen or tab and enable "Share system audio".'
            : 'Records a line-in, microphone or loopback device.'}{' '}
          Keeps running after this dialog closes.
        </Text>
        <Button
          fullWidth
          variant={running ? 'filled' : 'default'}
          color={running ? 'green' : undefined}
          loading={starting}
          leftSection={running ? <TbPlayerStop /> : <TbMicrophone />}
          onClick={() => (running ? stopCapture(pattern) : void start())}
        >
          {running ? 'Stop capture' : 'Start capture'}
        </Button>

        {running && <Progress value={level * 100} size={'sm'} transitionDuration={0} />}

        {error && (
          <Text c={'red'} size={'sm'}>
            {error}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
