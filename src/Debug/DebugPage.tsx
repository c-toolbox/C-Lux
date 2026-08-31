import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  ColorInput,
  Container,
  Group,
  Loader,
  NumberInput,
  Slider,
  Stack,
  Switch,
  Text,
  Title
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import config from '../../config.json';
import { api, type DebugUpdate } from '../lib/api';
import { hexToRgb, rgbToHex } from '../lib/color';
import { describeError } from '../lib/errors';
import { PatternVisualizer } from '../PatternVisualizer/PatternVisualizer';

const MAX_LIGHT = config.nLights - 1;

// Wiring check for a single fixture: suspend whatever the house is showing, then walk one
// light at a time along the ring. The overrides live on the server so they reach the
// Art-Net output as well as the preview, and are dropped when the server restarts.
export function DebugPage() {
  const [loading, setLoading] = useState(true);
  const [suspended, setSuspended] = useState(false);
  // Whether the single-light override is on. The slider keeps its position either way, so
  // the index it points at is tracked separately from whether the server is using it.
  const [driving, setDriving] = useState(false);
  const [light, setLight] = useState(0);
  const [hex, setHex] = useState('#ffffff');

  function showError(e: unknown) {
    notifications.show({ color: 'red', title: 'Error', message: describeError(e) });
  }

  // Fire-and-forget: the local state is what the controls render, so a slow reply can't
  // make the slider jump back while it is being dragged.
  function push(update: DebugUpdate) {
    void api.setDebug(update).catch(showError);
  }

  useEffect(() => {
    void api
      .debug()
      .then((status) => {
        setSuspended(status.suspended);
        setDriving(status.light !== null);
        setLight(status.light ?? 0);
        setHex(rgbToHex(status.color));
      })
      .catch(showError)
      .finally(() => setLoading(false));
  }, []);

  function changeSuspended(value: boolean) {
    setSuspended(value);
    push({ suspended: value });
  }

  function changeDriving(value: boolean) {
    setDriving(value);
    push({ light: value ? light : null, color: hexToRgb(hex) });
  }

  function changeLight(value: number) {
    setLight(value);
    if (driving) push({ light: value });
  }

  return (
    <Container fluid w={'100%'} px={'5%'} py={'xl'}>
      <Group justify={'space-between'} align={'center'} gap={'xs'}>
        <Title order={1} ta={'left'}>
          C-Lux debug
        </Title>
        <Button component={Link} to={'/'} variant={'default'}>
          Home
        </Button>
      </Group>

      {loading ? (
        <Group justify={'center'} py={'xl'}>
          <Loader />
        </Group>
      ) : (
        <Stack mt={'xl'} maw={520} mx={'auto'}>
          <PatternVisualizer />

          <Stack gap={'xs'}>
            <Text fw={600}>Active scene</Text>
            <Group gap={'xs'}>
              <Button
                variant={suspended ? 'default' : 'filled'}
                onClick={() => changeSuspended(false)}
              >
                Enable scene
              </Button>
              <Button
                color={'red'}
                variant={suspended ? 'filled' : 'default'}
                onClick={() => changeSuspended(true)}
              >
                Disable scene
              </Button>
            </Group>
            <Text c={'dimmed'} size={'sm'}>
              Disabling blanks the output without stopping the patterns, so the scene
              picks up where it left off when it is enabled again.
            </Text>
          </Stack>

          <Stack gap={'xs'} mt={'md'}>
            <Switch
              checked={driving}
              onChange={(e) => changeDriving(e.currentTarget.checked)}
              label={<Text fw={600}>Drive a single light</Text>}
            />
            <Text c={'dimmed'} size={'sm'}>
              While this is on every other light is dark, whatever the scene is doing.
            </Text>

            <Group align={'flex-end'} gap={'md'} wrap={'nowrap'} mt={'xs'}>
              <Slider
                style={{ flex: 1 }}
                min={0}
                max={MAX_LIGHT}
                step={1}
                value={light}
                onChange={changeLight}
                label={(value) => `Light ${value}`}
                marks={[
                  { value: 0, label: '0' },
                  { value: MAX_LIGHT, label: String(MAX_LIGHT) }
                ]}
              />
              <NumberInput
                w={100}
                min={0}
                max={MAX_LIGHT}
                clampBehavior={'strict'}
                value={light}
                onChange={(value) =>
                  changeLight(typeof value === 'number' ? value : Number(value) || 0)
                }
                aria-label={'Light index'}
              />
            </Group>

            <ColorInput
              mt={'md'}
              format={'hex'}
              label={'Light color'}
              value={hex}
              onChange={setHex}
              onChangeEnd={(value) => push({ color: hexToRgb(value) })}
            />
          </Stack>
        </Stack>
      )}
    </Container>
  );
}
