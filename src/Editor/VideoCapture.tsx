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
  DEFAULT_RIM_GEOMETRY,
  type RimGeometry,
  startVideoCapture,
  type VideoCaptureHandle,
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

const SLIDERS = [
  { key: 'centerX', label: 'Center X', min: 0, max: 1 },
  { key: 'centerY', label: 'Center Y', min: 0, max: 1 },
  { key: 'radius', label: 'Radius', min: 0.2, max: 1.4 },
  { key: 'ringInner', label: 'Ring inner', min: 0, max: 1 },
  { key: 'ringOuter', label: 'Ring outer', min: 0, max: 1 }
] as const satisfies ReadonlyArray<{
  key: keyof RimGeometry;
  label: string;
  min: number;
  max: number;
}>;

// Feeds the Video pattern: patterns run on the server, which has no video decoder, so
// this tab samples the feed down to a strip of colors and streams that over the API.
export function VideoCapture() {
  const [source, setSource] = useState<VideoSource>('screen');
  const [mode, setMode] = useState<VideoMode>('fisheye');
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [geometry, setGeometry] = useState<RimGeometry>(DEFAULT_RIM_GEOMETRY);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const handle = useRef<VideoCaptureHandle | null>(null);

  // The sampler reads the geometry every frame, so it needs the live value rather than
  // the one captured when the run started.
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;

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

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    const band = Math.abs(geometry.ringOuter - geometry.ringInner) * r;
    ctx.strokeStyle = 'rgba(77, 171, 247, 0.45)';
    ctx.lineWidth = Math.max(1, band);
    ctx.beginPath();
    ctx.arc(cx, cy, ((geometry.ringInner + geometry.ringOuter) / 2) * r, 0, Math.PI * 2);
    ctx.stroke();

    // Where the first light reads from, so the pattern's rotation can be lined up.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(
      cx,
      cy - ((geometry.ringInner + geometry.ringOuter) / 2) * r,
      3,
      0,
      Math.PI * 2
    );
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
        mode,
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
            disabled={capturing || starting}
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

        <Box
          style={{
            position: 'relative',
            width: '100%',
            // A square box cropping to fill shows exactly what the rim sampler reads.
            aspectRatio: fisheye ? '1 / 1' : '16 / 9',
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
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              objectFit: fisheye ? 'cover' : 'contain'
            }}
          />
          {fisheye && (
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
          )}
        </Box>

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

        {fisheye && (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={'xs'} verticalSpacing={4}>
            {SLIDERS.map(({ key, label, min, max }) => (
              <Box key={key}>
                <Text size={'xs'} c={'dimmed'}>
                  {label}
                </Text>
                <Slider
                  size={'sm'}
                  min={min}
                  max={max}
                  step={0.01}
                  value={geometry[key]}
                  onChange={(value) => setGeometry((g) => ({ ...g, [key]: value }))}
                />
              </Box>
            ))}
          </SimpleGrid>
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
