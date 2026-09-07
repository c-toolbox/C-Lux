import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Group,
  NativeSelect,
  NumberInput,
  Paper,
  SimpleGrid,
  Slider,
  Stack,
  Text
} from '@mantine/core';

import { NDI_PREVIEW_INTERVAL_MS } from '../../shared/ndi';
import { api, type NdiPreview, ndiPreview, type NdiSource } from '../lib/api';
import { describeError } from '../lib/errors';
import {
  DEFAULT_VIDEO_GEOMETRY,
  rimScale,
  startVideoCapture,
  type VideoCaptureHandle,
  type VideoGeometry,
  type VideoInput,
  type VideoMode
} from '../lib/video';

const SOURCES = [
  { value: 'camera', label: 'Camera' },
  { value: 'screen', label: 'Screen or window' },
  { value: 'ndi', label: 'NDI stream' }
];

const MODES = [
  { value: 'strip', label: 'Strip' },
  { value: 'fisheye', label: 'Fisheye rim' }
];

// Matches the working resolution the sampler uses, so the overlay can be drawn in the
// same coordinates the geometry describes and then scaled by CSS.
const OVERLAY_SIZE = 256;

// The preview only has to show what is being sampled, so it stays small enough to leave
// the pattern list and the visualiser their room.
const PREVIEW_WIDTH = 450;

// Below this the sliders are unusable, so they wrap under the preview instead of
// squeezing it and cropping the frame.
const SLIDER_MIN_WIDTH = 240;

interface SliderSpec {
  key: keyof VideoGeometry;
  label: string;
  min: number;
  max: number;
  step?: number;
}

// Centre and radius are aimed by eye against the overlay, and a pixel of drag is coarser
// than the adjustment that is still visible on the ring, so they step in thousandths and
// are also typeable in the box next to the slider.
const RIM_SLIDERS: readonly SliderSpec[] = [
  { key: 'centerX', label: 'Center X', min: 0, max: 1, step: 0.001 },
  { key: 'centerY', label: 'Center Y', min: 0, max: 1, step: 0.001 },
  { key: 'radius', label: 'Radius', min: 0, max: 1.4, step: 0.001 },
  { key: 'ringWidth', label: 'Ring width', min: 0, max: 1, step: 0.001 },
  // A full turn, so the feed's "up" can be dragged onto the top of the light ring.
  { key: 'rotation', label: 'Rotation', min: 0, max: 1, step: 0.001 }
];

const STRIP_SLIDERS: readonly SliderSpec[] = [
  { key: 'stripY', label: 'Strip position', min: 0, max: 1, step: 0.001 },
  // Fine steps, because a usable band is only a few percent of the frame.
  { key: 'stripHeight', label: 'Strip height', min: 0.005, max: 1, step: 0.005 }
];

// Slider values are fractions, so a step of 0.001 needs three places to be readable.
function decimals(step: number) {
  return Math.max(0, Math.ceil(-Math.log10(step)));
}

// Dragging lands on binary fractions of the track, so snap to the step before storing.
function quantise(value: number, min: number, max: number, step: number) {
  const snapped = Math.round((value - min) / step) * step + min;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(decimals(step) + 2))));
}

// Feeds the Video pattern: patterns run on the server, which has no video decoder, so
// this tab samples the feed down to a strip of colors and streams that over the API.
// NDI is the exception — a browser cannot join an NDI stream, so the server receives and
// samples that one itself and this panel only aims it and watches a preview.
export function VideoCapture() {
  const [input, setInput] = useState<VideoInput>('screen');
  const [mode, setMode] = useState<VideoMode>('fisheye');
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [geometry, setGeometry] = useState<VideoGeometry>(DEFAULT_VIDEO_GEOMETRY);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<NdiSource[]>([]);
  const [source, setSource] = useState('');
  const [scanning, setScanning] = useState(false);
  // Shown at the stream's own aspect ratio, uncropped: the samplers read the whole
  // frame, so the overlays only line up if the preview shows all of it.
  const [aspect, setAspect] = useState(16 / 9);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const handle = useRef<VideoCaptureHandle | null>(null);

  const ndi = input === 'ndi';

  // The sampler reads the geometry every frame, so it needs the live value rather than
  // the one captured when the run started.
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const stopBrowser = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
  }, []);

  // The browser's own "stop sharing" control ends the track without going through us.
  const onEnded = useCallback(() => {
    stopBrowser();
    setCapturing(false);
  }, [stopBrowser]);

  // Only the browser capture is torn down with the panel: the server's NDI receiver has
  // no reason to stop just because this tab navigated away.
  useEffect(() => stopBrowser, [stopBrowser]);

  // Adopt a receiver that is already running, so reopening the page shows what the lights
  // are actually being fed rather than an idle panel.
  useEffect(() => {
    let cancelled = false;
    api
      .ndi()
      .then((status) => {
        if (cancelled || !status.running) return;
        setInput('ndi');
        setSource(status.source ?? '');
        setMode(status.mode);
        setGeometry(status.geometry);
        setCapturing(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const found = await api.ndiSources();
      setSources(found);
      // Keep the current pick if it is still on the network, otherwise take the first.
      setSource((current) =>
        found.some((s) => s.name === current) ? current : (found[0]?.name ?? '')
      );
    } catch (e) {
      setError(describeError(e));
    } finally {
      setScanning(false);
    }
  }, []);

  // Discovery takes a moment to warm up, so the list is fetched when NDI is picked rather
  // than waiting for the user to open the dropdown and find it empty.
  useEffect(() => {
    if (ndi) void scan();
  }, [ndi, scan]);

  // Re-aim the running receiver as the sliders move. Debounced, because dragging a slider
  // produces a value per frame and the receiver only needs the one it settles on.
  useEffect(() => {
    if (!ndi || !capturing) return;
    const timer = setTimeout(() => {
      api.setNdi({ mode, geometry }).catch((e: unknown) => setError(describeError(e)));
    }, 80);
    return () => clearTimeout(timer);
  }, [ndi, capturing, mode, geometry]);

  const stop = useCallback(() => {
    stopBrowser();
    setCapturing(false);
  }, [stopBrowser]);

  // Paint the strip that was last sent, one pixel per color, stretched by CSS.
  const onStrip = useCallback((width: number, rgb: Uint8Array) => {
    const canvas = stripRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || width === 0) return;
    if (canvas.width !== width) canvas.width = width;

    const image = ctx.createImageData(width, 1);
    for (let i = 0; i < width; i++) {
      image.data[i * 4] = rgb[i * 3];
      image.data[i * 4 + 1] = rgb[i * 3 + 1];
      image.data[i * 4 + 2] = rgb[i * 3 + 2];
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, []);

  const drawPreview = useCallback((frame: NdiPreview) => {
    const canvas = previewRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width;
      canvas.height = frame.height;
    }

    const image = ctx.createImageData(frame.width, frame.height);
    for (let i = 0; i < frame.width * frame.height; i++) {
      image.data[i * 4] = frame.rgb[i * 3];
      image.data[i * 4 + 1] = frame.rgb[i * 3 + 1];
      image.data[i * 4 + 2] = frame.rgb[i * 3 + 2];
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    const next = frame.width / frame.height;
    setAspect((current) => (Math.abs(current - next) < 1e-6 ? current : next));
  }, []);

  // Poll the server for what its receiver is reading. Asking is also what makes it render
  // previews at all, so this stops the moment the panel does.
  useEffect(() => {
    if (!ndi || !capturing) return;

    const controller = new AbortController();
    let timer = 0;
    let cancelled = false;

    const poll = async () => {
      try {
        const frame = await ndiPreview(controller.signal);
        if (cancelled) return;
        if (frame !== null) {
          drawPreview(frame);
          onStrip(frame.strip.length / 3, frame.strip);
        }
      } catch {
        // A dropped poll is not worth reporting; the next one is 100ms away.
      }
      if (!cancelled) timer = window.setTimeout(poll, NDI_PREVIEW_INTERVAL_MS);
    };
    void poll();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [ndi, capturing, drawPreview, onStrip]);

  // Show which part of the image the rim sampler is reading.
  useEffect(() => {
    const ctx = overlayRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, OVERLAY_SIZE, OVERLAY_SIZE);

    const half = OVERLAY_SIZE / 2;
    const cx = geometry.centerX * OVERLAY_SIZE;
    const cy = geometry.centerY * OVERLAY_SIZE;
    const r = geometry.radius * half;
    const scale = rimScale(aspect);

    const band = geometry.ringWidth * r;

    // The square overlay is stretched to the frame's aspect ratio, so squashing here by
    // the same factors the sampler uses puts a true circle on screen.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale.x, scale.y);

    ctx.strokeStyle = 'rgba(77, 171, 247, 0.45)';
    ctx.lineWidth = Math.max(1 / Math.min(scale.x, scale.y), band);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // Where the first light reads from, so the rotation can be lined up with the ring.
    const angle = geometry.rotation * Math.PI * 2 - Math.PI / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * r, Math.sin(angle) * r, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }, [geometry, mode, capturing, aspect]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      if (input === 'ndi') {
        const status = await api.setNdi({ source, mode, geometry });
        if (!status.running) {
          throw new Error(
            status.reason ?? status.error ?? 'That NDI source could not be opened'
          );
        }
      } else {
        const video = videoRef.current;
        if (!video) return;

        handle.current = await startVideoCapture({
          source: input,
          mode: () => modeRef.current,
          video,
          geometry: () => geometryRef.current,
          onStrip,
          onEnded
        });
      }
      setCapturing(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setStarting(false);
    }
  }

  async function halt() {
    if (!ndi) {
      stop();
      return;
    }

    setStarting(true);
    try {
      await api.setNdi({ source: null });
      setCapturing(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setStarting(false);
    }
  }

  const fisheye = mode === 'fisheye';
  const sliders = fisheye ? RIM_SLIDERS : STRIP_SLIDERS;

  // Same clamping the sampler applies, so the band drawn here is the one being read.
  const bandHeight = Math.min(1, Math.max(0.005, geometry.stripHeight));
  const bandTop = Math.min(1 - bandHeight, Math.max(0, geometry.stripY - bandHeight / 2));

  return (
    <Paper withBorder p={'sm'} radius={'md'}>
      <Stack gap={'xs'}>
        <Group grow align={'flex-end'}>
          <NativeSelect
            label={'Video input'}
            value={input}
            data={SOURCES}
            disabled={capturing || starting}
            onChange={(e) => setInput(e.currentTarget.value as VideoInput)}
          />
          <NativeSelect
            label={'Mode'}
            description={
              fisheye ? 'Samples a ring inside a circular image' : 'One row of pixels'
            }
            value={mode}
            data={MODES}
            disabled={starting}
            onChange={(e) => setMode(e.currentTarget.value as VideoMode)}
          />
          <Button
            variant={capturing ? 'filled' : 'default'}
            color={capturing ? 'green' : undefined}
            loading={starting}
            disabled={!capturing && ndi && source === ''}
            onClick={() => void (capturing ? halt() : start())}
          >
            {capturing ? 'Stop capture' : 'Start capture'}
          </Button>
        </Group>

        {ndi && (
          <Group align={'flex-end'} gap={'xs'} wrap={'nowrap'}>
            <NativeSelect
              label={'NDI source'}
              description={'Senders the server can see on the network'}
              style={{ flex: 1, minWidth: 0 }}
              value={source}
              data={
                sources.length === 0
                  ? [{ value: '', label: scanning ? 'Searching…' : 'No sources found' }]
                  : sources.map((s) => ({ value: s.name, label: s.name }))
              }
              disabled={capturing || starting || sources.length === 0}
              onChange={(e) => setSource(e.currentTarget.value)}
            />
            <Button
              variant={'default'}
              loading={scanning}
              disabled={capturing}
              onClick={() => void scan()}
            >
              Rescan
            </Button>
          </Group>
        )}

        <Group align={'flex-start'} gap={'sm'} wrap={'wrap'}>
          <Box
            style={{
              position: 'relative',
              flex: `1 1 ${PREVIEW_WIDTH}px`,
              maxWidth: PREVIEW_WIDTH,
              aspectRatio: `${aspect}`,
              background: 'black',
              borderRadius: 'var(--mantine-radius-sm)',
              overflow: 'hidden',
              display: capturing ? 'block' : 'none'
            }}
          >
            <video
              ref={videoRef}
              muted
              playsInline
              onLoadedMetadata={(e) => {
                const { videoWidth, videoHeight } = e.currentTarget;
                if (videoWidth && videoHeight) setAspect(videoWidth / videoHeight);
              }}
              style={{
                display: ndi ? 'none' : 'block',
                width: '100%',
                height: '100%',
                objectFit: 'fill'
              }}
            />
            {/* NDI never reaches this tab, so the preview is the low-resolution copy the
                server renders from the frames it is sampling. */}
            <canvas
              ref={previewRef}
              style={{
                display: ndi ? 'block' : 'none',
                width: '100%',
                height: '100%',
                objectFit: 'fill'
              }}
            />
            {fisheye ? (
              <canvas
                ref={overlayRef}
                width={OVERLAY_SIZE}
                height={OVERLAY_SIZE}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none'
                }}
              />
            ) : (
              <Box
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: `${bandTop * 100}%`,
                  height: `${bandHeight * 100}%`,
                  border: '1px solid rgba(77, 171, 247, 0.9)',
                  background: 'rgba(77, 171, 247, 0.15)',
                  pointerEvents: 'none'
                }}
              />
            )}
          </Box>

          <SimpleGrid
            cols={{ base: 1, sm: fisheye ? 2 : 1 }}
            spacing={'xs'}
            verticalSpacing={4}
            style={{ flex: `1 1 ${SLIDER_MIN_WIDTH}px`, minWidth: 0 }}
          >
            {sliders.map(({ key, label, min, max, step = 0.01 }) => {
              const set = (value: number) =>
                setGeometry((g) => ({ ...g, [key]: quantise(value, min, max, step) }));

              return (
                <Box key={key}>
                  <Group justify={'space-between'} gap={4} wrap={'nowrap'}>
                    <Text size={'xs'} c={'dimmed'}>
                      {label}
                    </Text>
                    <NumberInput
                      size={'xs'}
                      w={86}
                      min={min}
                      max={max}
                      step={step}
                      clampBehavior={'strict'}
                      decimalScale={decimals(step)}
                      fixedDecimalScale
                      value={geometry[key]}
                      onChange={(value) => {
                        const next = typeof value === 'number' ? value : Number(value);
                        if (Number.isFinite(next)) set(next);
                      }}
                    />
                  </Group>
                  <Slider
                    size={'sm'}
                    label={(v) => v.toFixed(decimals(step))}
                    min={min}
                    max={max}
                    step={step}
                    value={geometry[key]}
                    onChange={set}
                  />
                </Box>
              );
            })}
          </SimpleGrid>
        </Group>

        {capturing && (
          <canvas
            ref={stripRef}
            height={1}
            style={{
              display: 'block',
              width: '100%',
              height: 14,
              borderRadius: 'var(--mantine-radius-sm)',
              imageRendering: 'pixelated'
            }}
          />
        )}

        {error && (
          <Text c={'red'} size={'sm'}>
            {error}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
