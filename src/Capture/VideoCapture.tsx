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

import { describeError } from '../lib/errors';
import {
  DEFAULT_VIDEO_GEOMETRY,
  rimScale,
  startVideoCapture,
  type VideoCaptureHandle,
  type VideoGeometry,
  type VideoMode,
  type VideoSource
} from '../lib/video';

const SOURCES = [
  { value: 'camera', label: 'Camera' },
  { value: 'screen', label: 'Screen or window' }
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
export function VideoCapture() {
  const [source, setSource] = useState<VideoSource>('screen');
  const [mode, setMode] = useState<VideoMode>('fisheye');
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [geometry, setGeometry] = useState<VideoGeometry>(DEFAULT_VIDEO_GEOMETRY);
  const [error, setError] = useState<string | null>(null);
  // Shown at the stream's own aspect ratio, uncropped: the samplers read the whole
  // frame, so the overlays only line up if the preview shows all of it.
  const [aspect, setAspect] = useState(16 / 9);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const handle = useRef<VideoCaptureHandle | null>(null);

  // The sampler reads the geometry every frame, so it needs the live value rather than
  // the one captured when the run started.
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setCapturing(false);
  }, []);

  useEffect(() => stop, [stop]);

  // Paint the strip that was last sent, one pixel per color, stretched by CSS.
  const onStrip = useCallback((width: number, rgb: Uint8Array) => {
    const canvas = stripRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
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
    const video = videoRef.current;
    if (!video) return;

    setStarting(true);
    setError(null);
    try {
      handle.current = await startVideoCapture({
        source,
        mode: () => modeRef.current,
        video,
        geometry: () => geometryRef.current,
        onStrip,
        onEnded: stop
      });
      setCapturing(true);
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
            value={source}
            data={SOURCES}
            disabled={capturing || starting}
            onChange={(e) => setSource(e.currentTarget.value as VideoSource)}
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
            onClick={() => (capturing ? stop() : void start())}
          >
            {capturing ? 'Stop capture' : 'Start capture'}
          </Button>
        </Group>

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
                display: 'block',
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
