import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { TbPlayerStop, TbRefresh, TbVideo } from 'react-icons/tb';
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
import { setVideoStrip, type VideoCaptureSettings } from '../../shared/video';
import {
  api,
  type NdiPreview,
  ndiPreview,
  type NdiSource,
  type NdiStatus,
  patternFields,
  VIDEO_TYPE
} from '../lib/api';
import {
  setVideoSettings,
  startVideo,
  stopCapture,
  useCapture,
  videoSourceOf
} from '../lib/captures';
import { describeError } from '../lib/errors';
import {
  rimScale,
  VIDEO_INPUT_NDI,
  VIDEO_SAMPLING_FISHEYE,
  type VideoGeometry
} from '../lib/video';

// The pattern's own schema, so the panel offers the same ranges the editor and the
// server validation use.
const FIELDS = patternFields(VIDEO_TYPE)!;

// How often the panel asks the server how its NDI receiver is doing.
const NDI_STATUS_INTERVAL_MS = 1000;

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
  step: number;
}

// Centre and radius are aimed by eye against the overlay, and a pixel of drag is coarser
// than the adjustment that is still visible on the ring, so the fields step in
// thousandths and are also typeable in the box next to the slider.
function sliderOf(key: keyof VideoGeometry): SliderSpec {
  const spec = FIELDS[key];
  if (spec?.kind !== 'number') throw new Error(`Video field ${key} is not a number`);
  return {
    key,
    label: spec.label,
    min: spec.min ?? 0,
    max: spec.max ?? 1,
    step: spec.step ?? 0.01
  };
}

const RIM_SLIDERS = (
  ['centerX', 'centerY', 'radius', 'ringWidth', 'rotation'] as const
).map(sliderOf);

const STRIP_SLIDERS = (['stripY', 'stripHeight'] as const).map(sliderOf);

const GEOMETRY_KEYS = [...RIM_SLIDERS, ...STRIP_SLIDERS].map((s) => s.key);

function sameSettings(a: VideoCaptureSettings, b: VideoCaptureSettings) {
  return (
    a.ndiSource === b.ndiSource &&
    a.sampling === b.sampling &&
    GEOMETRY_KEYS.every((key) => a.geometry[key] === b.geometry[key])
  );
}

// Slider values are fractions, so a step of 0.001 needs three places to be readable.
function decimals(step: number) {
  return Math.max(0, Math.ceil(-Math.log10(step)));
}

// Dragging lands on binary fractions of the track, so snap to the step before storing.
function quantise(value: number, min: number, max: number, step: number) {
  const snapped = Math.round((value - min) / step) * step + min;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(decimals(step) + 2))));
}

interface VideoCaptureProps {
  // The key of the capture: the pattern's saved name, or `DRAFT_CAPTURE` while adding it.
  pattern: string;
  // What the pattern has saved, which is what the server's NDI receiver follows; null
  // while the pattern is still being added.
  saved: VideoCaptureSettings | null;
  // The dialog's current values, which a browser capture follows straight away.
  settings: VideoCaptureSettings;
  // The dialog's own inputs for the capture, shown at the top of the panel.
  controls: ReactNode;
  onChange: (key: string, value: number | string) => void;
}

// Feeds the Video pattern: patterns run on the server, which has no video decoder, so
// this tab samples the feed down to a strip of colors and streams that over the API.
// NDI is the exception — a browser cannot join an NDI stream, so the server receives and
// samples the source the pattern names itself and this panel only watches a preview.
// The sliders aim the sampling by eye against the preview.
export function VideoCapture({
  pattern: name,
  saved,
  settings,
  controls,
  onChange
}: VideoCaptureProps) {
  const { input, ndiSource, sampling, geometry } = settings;
  const capture = useCapture(name);
  const running = capture?.kind === 'video' ? capture : null;
  const source = videoSourceOf(input);
  // The server only runs a receiver for a pattern it has.
  const ndi = input === VIDEO_INPUT_NDI;
  const receiver = ndi && saved !== null;

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<NdiStatus | null>(null);
  const [sources, setSources] = useState<NdiSource[]>([]);
  const [scanning, setScanning] = useState(false);
  // Shown at the stream's own aspect ratio, uncropped: the samplers read the whole
  // frame, so the overlays only line up if the preview shows all of it.
  const [aspect, setAspect] = useState(16 / 9);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setVideoSettings(name, sampling, geometry);
  }, [name, sampling, geometry]);

  // A capture of another kind or source no longer records what the pattern asks for.
  useEffect(() => {
    if (capture && (capture.kind !== 'video' || capture.source !== source)) {
      stopCapture(name);
    }
  }, [capture, source, name]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = running?.stream ?? null;
    if (running) void video.play().catch(() => undefined);
  }, [running]);

  // How the receiver is doing with the source the pattern names.
  useEffect(() => {
    if (!receiver) return;
    let cancelled = false;
    const poll = () =>
      api
        .ndi(name)
        .then((next) => {
          if (!cancelled) setStatus(next);
        })
        .catch(() => undefined);
    void poll();
    const timer = setInterval(() => void poll(), NDI_STATUS_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [receiver, name]);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      setSources(await api.ndiSources());
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

  const receiving = receiver && status?.running === true;
  const showPreview = ndi ? receiving : running !== null;

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

  useEffect(() => {
    if (!running) return;
    running.strips.add(onStrip);
    return () => {
      running.strips.delete(onStrip);
    };
  }, [running, onStrip]);

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
    if (!receiving) return;

    const controller = new AbortController();
    let timer = 0;
    let cancelled = false;

    const poll = async () => {
      try {
        const frame = await ndiPreview(name, controller.signal);
        if (cancelled) return;
        if (frame !== null) {
          drawPreview(frame);
          onStrip(frame.strip.length / 3, frame.strip);
          // Lets the dialog's pattern preview show what the receiver reads.
          setVideoStrip(name, frame.strip.length / 3, frame.strip, 'ndi');
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
  }, [receiving, name, drawPreview, onStrip]);

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
  }, [geometry, sampling, showPreview, aspect]);

  async function start() {
    if (source === null) return;

    setStarting(true);
    setError(null);
    try {
      await startVideo(name, source, sampling, geometry);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setStarting(false);
    }
  }

  const setSlider = (key: keyof VideoGeometry, value: number) => onChange(key, value);

  const fisheye = sampling === VIDEO_SAMPLING_FISHEYE;
  const sliders = fisheye ? RIM_SLIDERS : STRIP_SLIDERS;

  // Names the pattern holds but discovery hasn't seen are kept, so the pick stays visible.
  const sourceOptions = [
    ...(ndiSource === '' ? [{ value: '', label: 'Choose a source' }] : []),
    ...(ndiSource !== '' && !sources.some((s) => s.name === ndiSource)
      ? [{ value: ndiSource, label: `${ndiSource} (not found)` }]
      : []),
    ...sources.map((s) => ({ value: s.name, label: s.name }))
  ];

  // The receiver follows the saved pattern, so its state is about the saved source.
  const ndiState = !ndi
    ? null
    : saved === null
      ? 'The server starts receiving once the pattern is added.'
      : saved.ndiSource === ''
        ? 'No NDI source saved for this pattern'
        : receiving
          ? (status?.connections ?? 0) > 0
            ? `Receiving “${saved.ndiSource}”`
            : `Waiting for “${saved.ndiSource}” to connect`
          : (status?.reason ?? status?.error ?? `Opening “${saved.ndiSource}”…`);
  const unsaved = receiver && !sameSettings(saved, settings);

  // Same clamping the sampler applies, so the band drawn here is the one being read.
  const bandHeight = Math.min(1, Math.max(0.005, geometry.stripHeight));
  const bandTop = Math.min(1 - bandHeight, Math.max(0, geometry.stripY - bandHeight / 2));

  return (
    <Paper withBorder p={'sm'} radius={'md'}>
      <Stack gap={'xs'}>
        {controls}

        {!ndi && (
          <>
            <Text size={'sm'} c={'dimmed'}>
              Keeps running after this dialog closes.
            </Text>
            <Button
              fullWidth
              variant={running ? 'filled' : 'default'}
              color={running ? 'green' : undefined}
              loading={starting}
              leftSection={running ? <TbPlayerStop /> : <TbVideo />}
              onClick={() => (running ? stopCapture(name) : void start())}
            >
              {running ? 'Stop capture' : 'Start capture'}
            </Button>
          </>
        )}

        {ndi && (
          <Group align={'flex-end'} gap={'xs'} wrap={'nowrap'}>
            <NativeSelect
              label={'NDI source'}
              description={'Senders the server can see on the network'}
              style={{ flex: 1, minWidth: 0 }}
              value={ndiSource}
              data={
                sourceOptions.length === 0
                  ? [{ value: '', label: scanning ? 'Searching…' : 'No sources found' }]
                  : sourceOptions
              }
              disabled={sourceOptions.length === 0}
              onChange={(e) => onChange('ndiSource', e.currentTarget.value)}
            />
            <Button
              variant={'default'}
              loading={scanning}
              leftSection={<TbRefresh />}
              onClick={() => void scan()}
            >
              Rescan
            </Button>
          </Group>
        )}

        {ndiState && (
          <Text size={'sm'} c={receiving ? undefined : 'dimmed'}>
            {ndiState}
          </Text>
        )}

        {unsaved && (
          <Text size={'sm'} c={'orange'}>
            The server keeps receiving with the saved settings until you save.
          </Text>
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
              display: showPreview ? 'block' : 'none'
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
            {sliders.map(({ key, label, min, max, step }) => {
              const set = (value: number) =>
                setSlider(key, quantise(value, min, max, step));

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

        {showPreview && (
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

        {error && error !== ndiState && (
          <Text c={'red'} size={'sm'}>
            {error}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
