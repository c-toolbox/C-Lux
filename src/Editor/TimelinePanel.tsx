import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState
} from 'react';
import {
  TbPlayerPause,
  TbPlayerPlay,
  TbPlayerSkipBack,
  TbPlus,
  TbTimeline,
  TbTrash,
  TbX
} from 'react-icons/tb';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  NumberInput,
  Popover,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Tooltip
} from '@mantine/core';

import {
  type Clip,
  MAX_TIMELINE_DURATION,
  type Timeline,
  type TimelinePlayback,
  trackOf,
  wrapTime
} from '../lib/api';

export interface TimelineControl {
  playing?: boolean;
  time?: number;
}

interface TimelinePanelProps {
  playback: TimelinePlayback | null;
  // `performance.now()` when the playback was read, to run the playhead on from.
  fetchedAt: number;
  patterns: string[];
  onChange: (timeline: Timeline) => void;
  onControl: (control: TimelineControl) => void;
  onRemove: () => void;
}

const NEW_TIMELINE: Timeline = { duration: 30, loop: true, tracks: {} };
const SNAP = 0.1;
const MIN_CLIP = SNAP;
const NEW_CLIP = 5;
// Width, in pixels, of the grips on a clip's edges that resize it.
const EDGE_PX = 8;
const KNOB_PX = 10;
const LABEL_WIDTH = 160;
const ROW_HEIGHT = 28;
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

const snap = (t: number) => Math.round(t / SNAP) * SNAP;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// A clip over `start`..`end` with its fades shrunk, if need be, to fit inside it.
function clipOf(start: number, end: number, fadeIn: number, fadeOut: number): Clip {
  const length = end - start;
  const scale = fadeIn + fadeOut > length ? length / (fadeIn + fadeOut) : 1;
  return { start, end, fadeIn: fadeIn * scale, fadeOut: fadeOut * scale };
}

// The clips cut down to a shorter timeline, dropping any left too short.
function fitTracks(tracks: Timeline['tracks'], duration: number): Timeline['tracks'] {
  return Object.fromEntries(
    Object.entries(tracks).map(([name, clips]) => [
      name,
      clips
        .filter((c) => duration - c.start >= MIN_CLIP)
        .map((c) => clipOf(c.start, Math.min(duration, c.end), c.fadeIn, c.fadeOut))
    ])
  );
}

function withTrack(timeline: Timeline, pattern: string, clips: Clip[] | null): Timeline {
  const tracks = Object.entries(timeline.tracks).filter(([name]) => name !== pattern);
  if (clips) tracks.push([pattern, [...clips].sort((a, b) => a.start - b.start)]);
  return { ...timeline, tracks: Object.fromEntries(tracks) };
}

function formatTime(t: number): string {
  const minutes = Math.floor(t / 60);
  const seconds = (t - minutes * 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${seconds}`;
}

// The playback's time, run on in the browser between reads from the server.
function usePlayhead(playback: TimelinePlayback | null, fetchedAt: number): number {
  const [now, setNow] = useState(() => performance.now());
  const playing = playback?.playing ?? false;

  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function step() {
      setNow(performance.now());
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  if (!playback) return 0;
  if (!playback.playing) return playback.time;
  const elapsed = Math.max(0, now - fetchedAt) / 1000;
  return wrapTime(playback.timeline, playback.time + elapsed);
}

// A seconds field that only commits once the user is done typing, so every keystroke
// doesn't reach the server.
function SecondsInput({
  label,
  value,
  min,
  max,
  onCommit
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState<string | number>(value);
  useEffect(() => setText(value), [value]);

  function commit() {
    const parsed = typeof text === 'number' ? text : parseFloat(text);
    if (!Number.isFinite(parsed)) {
      setText(value);
      return;
    }
    const next = clamp(parsed, min, max);
    if (next !== value) onCommit(next);
    else setText(value);
  }

  return (
    <NumberInput
      size={'xs'}
      w={100}
      label={label}
      value={text}
      min={min}
      max={max}
      step={SNAP}
      decimalScale={2}
      onChange={setText}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

type DragMode = 'move' | 'start' | 'end' | 'fadeIn' | 'fadeOut';

interface Drag {
  pattern: string;
  index: number;
  mode: DragMode;
  x: number;
  width: number;
  clip: Clip;
}

export function TimelinePanel({
  playback,
  fetchedAt,
  patterns,
  onChange,
  onControl,
  onRemove
}: TimelinePanelProps) {
  const time = usePlayhead(playback, fetchedAt);
  // The timeline as a drag in progress has it, until the server has the result.
  const [draft, setDraft] = useState<Timeline | null>(null);
  const [selected, setSelected] = useState<{ pattern: string; index: number } | null>(
    null
  );
  const drag = useRef<Drag | null>(null);
  const [seeking, setSeeking] = useState<number | null>(null);
  // Where the right-click menu for the selected clip opened, if it is open.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // A re-read mid-drag mustn't snap the clip being dragged back to where it was.
  useEffect(() => {
    if (!drag.current) setDraft(null);
  }, [playback?.timeline]);

  if (!playback) {
    return (
      <Group gap={'md'}>
        <Button
          size={'xs'}
          leftSection={<TbTimeline />}
          onClick={() => onChange(NEW_TIMELINE)}
        >
          Add timeline
        </Button>
        <Text c={'dimmed'} size={'sm'}>
          This scene has no timeline. Add one to switch its patterns on and off over time.
        </Text>
      </Group>
    );
  }

  const timeline = draft ?? playback.timeline;
  const { duration } = timeline;
  const shownTime = seeking ?? time;
  const percent = (t: number) => `${(t / duration) * 100}%`;
  const step = RULER_STEPS.find((s) => duration / s <= 10) ?? duration;
  const ticks = Array.from(
    { length: Math.floor(duration / step) + 1 },
    (_, i) => i * step
  );

  const selectedClip = selected
    ? trackOf(timeline, selected.pattern)?.[selected.index]
    : undefined;

  function setDuration(next: number) {
    onChange({ ...timeline, duration: next, tracks: fitTracks(timeline.tracks, next) });
  }

  function replaceClip(pattern: string, index: number, clip: Clip | null) {
    const clips = [...(trackOf(timeline, pattern) ?? [])];
    if (clip) clips[index] = clip;
    else clips.splice(index, 1);
    const next = withTrack(timeline, pattern, clips);
    setSelected(clip ? { pattern, index: trackOf(next, pattern)!.indexOf(clip) } : null);
    onChange(next);
  }

  function addClip(pattern: string, at: number) {
    const start = clamp(snap(at), 0, Math.max(0, duration - MIN_CLIP));
    const clip = clipOf(start, Math.min(duration, start + NEW_CLIP), 0, 0);
    const clips = [...(trackOf(timeline, pattern) ?? []), clip];
    const next = withTrack(timeline, pattern, clips);
    setSelected({ pattern, index: trackOf(next, pattern)!.indexOf(clip) });
    onChange(next);
  }

  function timeAt(e: ReactPointerEvent | ReactMouseEvent, element: Element): number {
    const rect = element.getBoundingClientRect();
    return clamp(((e.clientX - rect.left) / rect.width) * duration, 0, duration);
  }

  function startDrag(
    e: ReactPointerEvent<HTMLDivElement>,
    mode: DragMode,
    pattern: string,
    index: number,
    clip: Clip
  ) {
    // Only the primary button drags; the right one opens the menu.
    if (e.button !== 0) return;
    e.stopPropagation();
    // Ctrl (or Cmd) on an edge grip sets that end's fade instead of resizing.
    const fade = e.ctrlKey || e.metaKey;
    if (fade && mode === 'start') mode = 'fadeIn';
    else if (fade && mode === 'end') mode = 'fadeOut';
    const track = e.currentTarget.closest('[data-track]')!.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pattern, index, mode, x: e.clientX, width: track.width, clip };
    setSelected({ pattern, index });
  }

  function dragged(e: ReactPointerEvent): Clip | null {
    const d = drag.current;
    if (!d) return null;
    const delta = ((e.clientX - d.x) / d.width) * duration;
    const { start, end, fadeIn, fadeOut } = d.clip;
    const length = end - start;
    switch (d.mode) {
      case 'move': {
        const moved = clamp(snap(start + delta), 0, duration - length);
        return { ...d.clip, start: moved, end: Math.min(duration, moved + length) };
      }
      case 'start':
        return clipOf(
          clamp(snap(start + delta), 0, end - MIN_CLIP),
          end,
          fadeIn,
          fadeOut
        );
      case 'end':
        return clipOf(
          start,
          clamp(snap(end + delta), start + MIN_CLIP, duration),
          fadeIn,
          fadeOut
        );
      case 'fadeIn':
        return { ...d.clip, fadeIn: clamp(snap(fadeIn + delta), 0, length - fadeOut) };
      default:
        return { ...d.clip, fadeOut: clamp(snap(fadeOut - delta), 0, length - fadeIn) };
    }
  }

  function moveDrag(e: ReactPointerEvent) {
    const d = drag.current;
    const clip = dragged(e);
    if (!d || !clip) return;
    const clips = [...(trackOf(timeline, d.pattern) ?? [])];
    clips[d.index] = clip;
    setDraft({ ...timeline, tracks: { ...timeline.tracks, [d.pattern]: clips } });
  }

  function endDrag(e: ReactPointerEvent) {
    const d = drag.current;
    const clip = dragged(e);
    drag.current = null;
    if (!d || !clip) return;
    const { start, end, fadeIn, fadeOut } = d.clip;
    if (
      clip.start === start &&
      clip.end === end &&
      clip.fadeIn === fadeIn &&
      clip.fadeOut === fadeOut
    ) {
      setDraft(null);
      return;
    }
    replaceClip(d.pattern, d.index, clip);
  }

  function openMenu(e: ReactMouseEvent, pattern: string, index: number) {
    e.preventDefault();
    e.stopPropagation();
    setSelected({ pattern, index });
    setMenu({ x: e.clientX, y: e.clientY });
  }

  // Change the selected clip from the menu, keeping it selected wherever it lands.
  function editSelected(clip: Clip | null) {
    if (!selected) return;
    if (!clip) setMenu(null);
    replaceClip(selected.pattern, selected.index, clip);
  }

  const playhead = (
    <Box
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: percent(shownTime),
        width: 2,
        marginLeft: -1,
        background: 'var(--mantine-color-red-6)',
        pointerEvents: 'none'
      }}
    />
  );

  return (
    <Stack gap={'xs'}>
      <Group justify={'space-between'} align={'flex-end'}>
        <Group gap={'xs'} align={'center'}>
          <Tooltip label={'Restart'}>
            <ActionIcon
              variant={'default'}
              aria-label={'Restart timeline'}
              onClick={() => onControl({ time: 0, playing: true })}
            >
              <TbPlayerSkipBack />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={playback.playing ? 'Pause' : 'Play'}>
            <ActionIcon
              aria-label={playback.playing ? 'Pause timeline' : 'Play timeline'}
              onClick={() =>
                onControl(playback.playing ? { playing: false, time } : { playing: true })
              }
            >
              {playback.playing ? <TbPlayerPause /> : <TbPlayerPlay />}
            </ActionIcon>
          </Tooltip>
          <Text ff={'monospace'} size={'sm'}>
            {formatTime(shownTime)} / {formatTime(duration)}
          </Text>
        </Group>
        <Group gap={'md'} align={'flex-end'}>
          <SecondsInput
            label={'Length (s)'}
            value={duration}
            min={1}
            max={MAX_TIMELINE_DURATION}
            onCommit={setDuration}
          />
          <Switch
            label={'Loop'}
            checked={timeline.loop}
            onChange={(e) => onChange({ ...timeline, loop: e.currentTarget.checked })}
            mb={6}
          />
          <Button
            size={'xs'}
            color={'red'}
            variant={'light'}
            leftSection={<TbTrash />}
            onClick={() => {
              setSelected(null);
              setMenu(null);
              onRemove();
            }}
            mb={2}
          >
            Remove timeline
          </Button>
        </Group>
      </Group>

      {/* The playhead is drawn once over the ruler and every track, as one line. */}
      <Box style={{ position: 'relative' }}>
        <Stack gap={'xs'}>
          <Group gap={0} wrap={'nowrap'}>
            <Box w={LABEL_WIDTH} style={{ flexShrink: 0 }} />
            {/* Click or drag on the ruler to seek. */}
            <Box
              h={20}
              style={{
                position: 'relative',
                flex: 1,
                cursor: 'pointer',
                userSelect: 'none'
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setSeeking(timeAt(e, e.currentTarget));
              }}
              onPointerMove={(e) => {
                if (seeking !== null) setSeeking(timeAt(e, e.currentTarget));
              }}
              onPointerUp={(e) => {
                setSeeking(null);
                onControl({ time: timeAt(e, e.currentTarget) });
              }}
            >
              {ticks.map((t, i) => (
                <Text
                  key={t}
                  size={'xs'}
                  c={'dimmed'}
                  style={{
                    position: 'absolute',
                    left: percent(t),
                    // The end labels stay inside the ruler rather than spilling past it.
                    transform: `translateX(${i === 0 ? 0 : t === duration ? -100 : -50}%)`
                  }}
                >
                  {formatTime(t)}
                </Text>
              ))}
            </Box>
          </Group>

          {patterns.map((pattern) => {
            const clips = trackOf(timeline, pattern);
            return (
              <Group key={pattern} gap={0} wrap={'nowrap'}>
                <Group w={LABEL_WIDTH} gap={4} wrap={'nowrap'} style={{ flexShrink: 0 }}>
                  <Tooltip label={clips ? 'Always on instead' : 'Time with the timeline'}>
                    <ActionIcon
                      size={'sm'}
                      variant={'subtle'}
                      color={clips ? 'red' : undefined}
                      aria-label={clips ? `Stop timing ${pattern}` : `Time ${pattern}`}
                      onClick={() => {
                        if (selected?.pattern === pattern) setSelected(null);
                        if (clips) onChange(withTrack(timeline, pattern, null));
                        else addClip(pattern, 0);
                      }}
                    >
                      {clips ? <TbX /> : <TbPlus />}
                    </ActionIcon>
                  </Tooltip>
                  <Text size={'sm'} truncate>
                    {pattern}
                  </Text>
                </Group>
                <Box
                  data-track
                  h={ROW_HEIGHT}
                  style={{
                    position: 'relative',
                    flex: 1,
                    borderRadius: 4,
                    background: 'var(--mantine-color-default-hover)',
                    border: clips
                      ? undefined
                      : '1px dashed var(--mantine-color-default-border)',
                    userSelect: 'none'
                  }}
                  onDoubleClick={(e) => addClip(pattern, timeAt(e, e.currentTarget))}
                >
                  {!clips && (
                    <Text size={'xs'} c={'dimmed'} px={'xs'} lh={`${ROW_HEIGHT}px`}>
                      Always on
                    </Text>
                  )}
                  {clips?.map((clip, index) => {
                    const length = clip.end - clip.start;
                    const rise = (clip.fadeIn / length) * 100;
                    const fall = 100 - (clip.fadeOut / length) * 100;
                    const isSelected =
                      selected?.pattern === pattern && selected.index === index;
                    const grip = (mode: DragMode) => ({
                      onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) =>
                        startDrag(e, mode, pattern, index, clip)
                    });
                    const edge = (side: 'left' | 'right') => ({
                      position: 'absolute' as const,
                      top: 0,
                      bottom: 0,
                      [side]: 0,
                      width: EDGE_PX,
                      cursor: 'ew-resize',
                      background: 'rgba(255, 255, 255, 0.25)'
                    });
                    const knob = (at: number) => ({
                      position: 'absolute' as const,
                      top: -KNOB_PX / 2,
                      left: `calc(${at}% - ${KNOB_PX / 2}px)`,
                      width: KNOB_PX,
                      height: KNOB_PX,
                      borderRadius: '50%',
                      cursor: 'ew-resize',
                      background: 'var(--mantine-color-white)',
                      border: '2px solid var(--mantine-color-blue-6)'
                    });
                    return (
                      <Box
                        key={index}
                        {...grip('move')}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onContextMenu={(e) => openMenu(e, pattern, index)}
                        onDoubleClick={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute',
                          top: 2,
                          bottom: 2,
                          left: percent(clip.start),
                          width: percent(length),
                          borderRadius: 3,
                          cursor: 'grab',
                          border: `${isSelected ? 2 : 1}px solid var(--mantine-color-blue-${isSelected ? 3 : 6})`,
                          background: `linear-gradient(to right, transparent, var(--mantine-color-blue-6) ${rise}%, var(--mantine-color-blue-6) ${fall}%, transparent)`
                        }}
                      >
                        <Box {...grip('start')} style={edge('left')} />
                        <Box {...grip('end')} style={edge('right')} />
                        <Box {...grip('fadeIn')} style={knob(rise)} title={'Fade in'} />
                        <Box {...grip('fadeOut')} style={knob(fall)} title={'Fade out'} />
                      </Box>
                    );
                  })}
                </Box>
              </Group>
            );
          })}
        </Stack>
        <Box
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: LABEL_WIDTH,
            right: 0,
            pointerEvents: 'none'
          }}
        >
          {playhead}
        </Box>
      </Box>

      <Text size={'xs'} c={'dimmed'}>
        Double-click a track to add a clip there. Drag a clip to move it, its edges to
        resize it (with Ctrl held, to set its fade) and the knobs on top to set its fades;
        right-click it to type exact times.
      </Text>

      <Popover
        opened={menu !== null && selectedClip !== undefined}
        onDismiss={() => setMenu(null)}
        position={'bottom-start'}
        shadow={'md'}
        withinPortal
      >
        <Popover.Target>
          <div
            style={{
              position: 'fixed',
              left: menu?.x ?? 0,
              top: menu?.y ?? 0,
              width: 0,
              height: 0
            }}
          />
        </Popover.Target>
        <Popover.Dropdown>
          {selected && selectedClip && (
            <Stack gap={'xs'}>
              <Text size={'sm'} fw={500}>
                {selected.pattern}
              </Text>
              <SimpleGrid cols={2} spacing={'xs'}>
                <SecondsInput
                  label={'Start'}
                  value={selectedClip.start}
                  min={0}
                  max={selectedClip.end - MIN_CLIP}
                  onCommit={(start) =>
                    editSelected(
                      clipOf(
                        start,
                        selectedClip.end,
                        selectedClip.fadeIn,
                        selectedClip.fadeOut
                      )
                    )
                  }
                />
                <SecondsInput
                  label={'End'}
                  value={selectedClip.end}
                  min={selectedClip.start + MIN_CLIP}
                  max={duration}
                  onCommit={(end) =>
                    editSelected(
                      clipOf(
                        selectedClip.start,
                        end,
                        selectedClip.fadeIn,
                        selectedClip.fadeOut
                      )
                    )
                  }
                />
                <SecondsInput
                  label={'Fade in'}
                  value={selectedClip.fadeIn}
                  min={0}
                  max={selectedClip.end - selectedClip.start - selectedClip.fadeOut}
                  onCommit={(fadeIn) => editSelected({ ...selectedClip, fadeIn })}
                />
                <SecondsInput
                  label={'Fade out'}
                  value={selectedClip.fadeOut}
                  min={0}
                  max={selectedClip.end - selectedClip.start - selectedClip.fadeIn}
                  onCommit={(fadeOut) => editSelected({ ...selectedClip, fadeOut })}
                />
              </SimpleGrid>
              <Button
                size={'xs'}
                color={'red'}
                variant={'light'}
                leftSection={<TbTrash />}
                onClick={() => editSelected(null)}
              >
                Delete clip
              </Button>
            </Stack>
          )}
        </Popover.Dropdown>
      </Popover>
    </Stack>
  );
}
