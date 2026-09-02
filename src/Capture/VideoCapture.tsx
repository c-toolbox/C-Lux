import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Group,
  NativeSelect,
  Paper,
  SimpleGrid,
  Slider,
  Stack,
  Text
} from '@mantine/core';

import { describeError } from '../lib/errors';
import {
  DEFAULT_VIDEO_GEOMETRY,
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

interface SliderSpec {
  key: keyof VideoGeometry;
  label: string;
  min: number;
  max: number;
  step?: number;
}

const RIM_SLIDERS: readonly SliderSpec[] = [
  { key: 'centerX', label: 'Center X', min: 0, max: 1 },
  { key: 'centerY', label: 'Center Y', min: 0, max: 1 },
  { key: 'radius', label: 'Radius', min: 0, max: 1.4 },
  { key: 'ringWidth', label: 'Ring width', min: 0, max: 1 }
];

const STRIP_SLIDERS: readonly SliderSpec[] = [
  { key: 'stripY', label: 'Strip position', min: 0, max: 1 },
  // Fine steps, because a usable band is only a few percent of the frame.
  { key: 'stripHeight', label: 'Strip height', min: 0.005, max: 1, step: 0.005 }
];

// Feeds the Video pattern: patterns run on the server, which has no video decoder, so
// this tab samples the feed down to a strip of colors and streams that over the API.
export function VideoCapture() {
  const [source, setSource] = useState<VideoSource>('screen');
  const [mode, setMode] = useState<VideoMode>('fisheye');
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [geometry, setGeometry] = useState<VideoGeometry>(DEFAULT_VIDEO_GEOMETRY);
  const [error, setError] = useState<string | null>(null);
  // Shown at the stream's own aspect ratio so the strip overlay lines up with the frame.
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

    const band = geometry.ringWidth * r;
    ctx.strokeStyle = 'rgba(77, 171, 247, 0.45)';
    ctx.lineWidth = Math.max(1, band);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Where the first light reads from, so the pattern's rotation can be lined up.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy - r, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [geometry, mode, capturing]);

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

  // A square box cropping to fill shows exactly what the rim sampler reads; strip mode
  // keeps the stream's own shape so the band overlay lines up.
  const ratio = fisheye ? 1 : aspect;

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

        <Group align={'flex-start'} gap={'sm'} wrap={'nowrap'}>
          <Box
            style={{
              position: 'relative',
              flex: 'none',
              width: `min(${PREVIEW_WIDTH}px, 100%)`,
              aspectRatio: `${ratio}`,
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
                objectFit: fisheye ? 'cover' : 'fill'
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
            style={{ flex: 1, minWidth: 0 }}
          >
            {sliders.map(({ key, label, min, max, step }) => (
              <Box key={key}>
                <Text size={'xs'} c={'dimmed'}>
                  {label}
                </Text>
                <Slider
                  size={'sm'}
                  min={min}
                  max={max}
                  step={step ?? 0.01}
                  value={geometry[key]}
                  onChange={(value) => setGeometry((g) => ({ ...g, [key]: value }))}
                />
              </Box>
            ))}
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
