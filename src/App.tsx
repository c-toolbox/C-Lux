import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  ColorInput,
  ColorSwatch,
  Container,
  Group,
  Loader,
  Modal,
  NativeSelect,
  NumberInput,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip
} from '@mantine/core';

import config from '../config.json';

import {
  api,
  type Color,
  PATTERN_TYPES,
  type PatternParameters,
  type PatternProps,
  type PatternType
} from './lib/api';

function clamp8(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex({ r, g, b }: Color): string {
  const hex = (n: number) => clamp8(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hexToRgb(hex: string): Color {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

interface FormValues {
  type: PatternType;
  name: string;
  hex: string;
  sigma: number;
  speed: number;
}

const DEFAULT_FORM: FormValues = {
  type: 'StaticPattern',
  name: '',
  hex: '#4dabf7',
  sigma: 1,
  speed: 1
};

function toProps(v: FormValues): PatternProps {
  const color = hexToRgb(v.hex);
  if (v.type === 'MovingGaussian') {
    return { name: v.name, ...color, sigma: v.sigma, speed: v.speed };
  }
  return { name: v.name, ...color };
}

const NAME_ADJECTIVES = [
  'brave',
  'calm',
  'clever',
  'crimson',
  'dapper',
  'electric',
  'golden',
  'lunar',
  'mellow',
  'neon',
  'quiet',
  'rapid',
  'silent',
  'solar',
  'velvet'
];
const NAME_NOUNS = [
  'otter',
  'falcon',
  'comet',
  'ember',
  'harbor',
  'lantern',
  'meadow',
  'nebula',
  'orbit',
  'pixel',
  'quartz',
  'ripple',
  'summit',
  'willow'
];

function randomName(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(NAME_ADJECTIVES)}-${pick(NAME_NOUNS)}`;
}

interface PatternFormProps {
  mode: 'add' | 'edit';
  initial: FormValues;
  namePlaceholder: string;
  existingNames: string[];
  busy: boolean;
  onSubmit: (values: FormValues) => void;
}

function PatternForm({
  mode,
  initial,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: PatternFormProps) {
  const [values, setValues] = useState<FormValues>(initial);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const nameTaken = mode === 'add' && existingNames.includes(values.name.trim());
  const nameError =
    values.name.trim() === ''
      ? 'Name is required'
      : nameTaken
        ? 'A pattern with this name already exists'
        : null;

  return (
    <Stack gap={'md'}>
      <NativeSelect
        label={'Type'}
        value={values.type}
        data={PATTERN_TYPES.map((t) => ({ value: t, label: t }))}
        disabled={mode === 'edit'}
        onChange={(e) => update('type', e.currentTarget.value as PatternType)}
      />

      <TextInput
        label={'Name'}
        placeholder={namePlaceholder}
        value={values.name}
        error={nameError}
        disabled={mode === 'edit'}
        onChange={(e) => update('name', e.currentTarget.value)}
      />

      <ColorInput
        label={'Color'}
        format={'hex'}
        value={values.hex}
        onChange={(v) => update('hex', v)}
      />

      {values.type === 'MovingGaussian' && (
        <Group grow>
          <NumberInput
            label={'Sigma'}
            min={0}
            step={0.5}
            value={values.sigma}
            onChange={(v) => update('sigma', typeof v === 'number' ? v : 0)}
          />
          <NumberInput
            label={'Speed'}
            step={1}
            value={values.speed}
            onChange={(v) => update('speed', typeof v === 'number' ? v : 0)}
          />
        </Group>
      )}

      <Button
        onClick={() => onSubmit(values)}
        loading={busy}
        disabled={nameError !== null}
      >
        {mode === 'add' ? 'Add pattern' : 'Save changes'}
      </Button>
    </Stack>
  );
}

function App() {
  const [patterns, setPatterns] = useState<PatternParameters[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [namePlaceholder, setNamePlaceholder] = useState(randomName());
  const [editing, setEditing] = useState<PatternParameters | null>(null);

  async function refresh() {
    try {
      setPatterns(await api.listPatterns());
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(values: FormValues) {
    await run(async () => {
      await api.addPattern(values.type, toProps(values));
      setAddOpen(false);
    });
  }

  async function handleEdit(values: FormValues) {
    await run(async () => {
      await api.updatePattern(values.name, toProps(values));
      setEditing(null);
    });
  }

  function handleRemove(name: string) {
    run(() => api.removePattern(name));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= patterns.length) return;
    const order = patterns.map((p) => p.name);
    [order[index], order[target]] = [order[target], order[index]];
    run(() => api.reorderPatterns(order));
  }

  const existingNames = patterns.map((p) => p.name);

  return (
    <Container size={'sm'} py={'xl'}>
      <Stack gap={'lg'}>
        <Group justify={'space-between'} align={'center'}>
          <div>
            <Title order={1}>C-Lux</Title>
            <Text c={'dimmed'}>Lighting pattern control</Text>
          </div>
        </Group>

        <Group justify={'space-between'}>
          <Text fw={500}>{patterns.length} pattern(s)</Text>
          <Button
            onClick={() => {
              setNamePlaceholder(randomName());
              setAddOpen(true);
            }}
          >
            Add pattern
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

        {loading ? (
          <Group justify={'center'} py={'xl'}>
            <Loader />
          </Group>
        ) : patterns.length === 0 ? (
          <Text c={'dimmed'} ta={'center'} py={'xl'}>
            No patterns yet. Add one to get started.
          </Text>
        ) : (
          <Stack gap={'sm'}>
            {patterns.map((p, i) => (
              <Group
                key={p.name}
                justify={'space-between'}
                p={'md'}
                style={{
                  border: '1px solid var(--mantine-color-default-border)',
                  borderRadius: 8
                }}
              >
                <Group>
                  <ColorSwatch color={rgbToHex(p.color)} />
                  <div>
                    <Text fw={600}>{p.name}</Text>
                    <Badge variant={'light'} size={'sm'}>
                      {p.type}
                    </Badge>
                  </div>
                </Group>

                <Group gap={'xs'}>
                  <Tooltip label={'Move up'}>
                    <ActionIcon
                      variant={'subtle'}
                      disabled={i === 0 || busy}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={'Move down'}>
                    <ActionIcon
                      variant={'subtle'}
                      disabled={i === patterns.length - 1 || busy}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </ActionIcon>
                  </Tooltip>
                  <Button size={'xs'} variant={'light'} onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                  <Button
                    size={'xs'}
                    color={'red'}
                    variant={'light'}
                    disabled={busy}
                    onClick={() => handleRemove(p.name)}
                  >
                    Remove
                  </Button>
                </Group>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>

      <Stack gap={'sm'} mt={'xl'}>
        <Title order={3}>Visualizer</Title>
        <PatternVisualizer />
      </Stack>

      <Modal
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        title={'Add pattern'}
        centered
      >
        <PatternForm
          key={namePlaceholder}
          mode={'add'}
          initial={{ ...DEFAULT_FORM, name: namePlaceholder }}
          namePlaceholder={namePlaceholder}
          existingNames={existingNames}
          busy={busy}
          onSubmit={handleAdd}
        />
      </Modal>

      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : ''}
        centered
      >
        {editing && (
          <PatternForm
            mode={'edit'}
            initial={{
              ...DEFAULT_FORM,
              type: editing.type,
              name: editing.name,
              hex: rgbToHex(editing.color),
              sigma: 'sigma' in editing ? editing.sigma : DEFAULT_FORM.sigma,
              speed: 'speed' in editing ? editing.speed : DEFAULT_FORM.speed
            }}
            namePlaceholder={editing.name}
            existingNames={existingNames}
            busy={busy}
            onSubmit={handleEdit}
          />
        )}
      </Modal>
    </Container>
  );
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const NUM_LIGHTS = config.nLights;

function drawLights(canvas: HTMLCanvasElement, data: number[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const ringR = size / 2 - 10;
  const lightR = Math.max(1.5, (Math.PI * ringR) / NUM_LIGHTS - 0.5);

  for (let i = 0; i < NUM_LIGHTS; i++) {
    // Counterclockwise: subtract from y so increasing index rotates upward.
    const a = (2 * Math.PI * i) / NUM_LIGHTS;
    const x = cx + ringR * Math.cos(a);
    const y = cy - ringR * Math.sin(a);
    const r = data[i * 3] ?? 0;
    const g = data[i * 3 + 1] ?? 0;
    const b = data[i * 3 + 2] ?? 0;

    ctx.beginPath();
    ctx.arc(x, y, lightR, 0, 2 * Math.PI);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.25)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

function PatternVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number;

    const BASE_MS = 200;
    const MAX_MS = 5000;
    let delay = BASE_MS;

    async function poll() {
      try {
        const data = await api.getPattern();
        if (!active) return;
        if (canvasRef.current) drawLights(canvasRef.current, data);
        delay = BASE_MS;
      } catch {
        // Back off while the backend is unreachable to avoid spamming requests.
        delay = Math.min(delay * 2, MAX_MS);
      }
      if (active) timer = window.setTimeout(poll, delay);
    }

    poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        maxWidth: 420,
        aspectRatio: '1 / 1',
        margin: '0 auto',
        display: 'block'
      }}
    />
  );
}

export default App;
