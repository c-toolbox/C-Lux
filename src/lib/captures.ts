import { useSyncExternalStore } from 'react';

import { setAudioFrame } from '../../shared/audio';
import { setVideoStrip } from '../../shared/video';

import {
  AUDIO_INPUT_DEVICE,
  AUDIO_TYPE,
  type AudioParameters,
  type PatternParameters,
  VIDEO_TYPE,
  videoCaptureOf
} from './api';
import { type AudioSource, startAudioCapture } from './audio';
import {
  startVideoCapture,
  VIDEO_INPUT_CAMERA,
  VIDEO_INPUT_NDI,
  type VideoGeometry,
  type VideoSource
} from './video';

// The browser captures outlive the dialog that starts them, so they are kept here, one per
// pattern and keyed by its name, for as long as the tab stays open. Every frame is also
// published to this page's own feed stores, so in-page previews of the pattern light up.

// The key of a capture started for a pattern that is still being added. Not a valid
// pattern name, so it is never posted and never clashes with a real pattern.
export const DRAFT_CAPTURE = '#draft';

const serverFeed = (capture: Running) =>
  capture.name === DRAFT_CAPTURE ? null : capture.name;

interface Running {
  // The pattern being fed; follows a rename.
  name: string;
  stream: MediaStream | null;
  stop: () => void;
}

export interface RunningAudio extends Running {
  kind: 'audio';
  source: AudioSource;
  levels: Set<(level: number) => void>;
}

export interface RunningVideo extends Running {
  kind: 'video';
  source: VideoSource;
  // Read by the sampler every frame.
  sampling: number;
  geometry: VideoGeometry;
  strips: Set<(width: number, rgb: Uint8Array) => void>;
}

export type RunningCapture = RunningAudio | RunningVideo;

const captures = new Map<string, RunningCapture>();
const listeners = new Set<() => void>();
// Bumped by every stop, so a start still waiting on the browser's picker can tell it was
// called off in the meantime.
const stops = new Map<string, number>();

function changed() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function add(capture: RunningCapture, stopsAtStart: number | undefined) {
  if (stops.get(capture.name) !== stopsAtStart) {
    capture.stop();
    return;
  }
  stopCapture(capture.name);
  captures.set(capture.name, capture);
  changed();
}

function forget(capture: RunningCapture) {
  if (captures.get(capture.name) !== capture) return;
  captures.delete(capture.name);
  changed();
}

export function audioSourceOf(input: number): AudioSource {
  return input === AUDIO_INPUT_DEVICE ? 'input' : 'system';
}

// NDI is received by the server, so there is nothing for the browser to capture.
export function videoSourceOf(input: number): VideoSource | null {
  if (input === VIDEO_INPUT_NDI) return null;
  return input === VIDEO_INPUT_CAMERA ? 'camera' : 'screen';
}

export function captureOf(name: string): RunningCapture | undefined {
  return captures.get(name);
}

export function useCapture(name: string): RunningCapture | undefined {
  return useSyncExternalStore(subscribe, () => captures.get(name));
}

export function stopCapture(name: string) {
  stops.set(name, (stops.get(name) ?? 0) + 1);
  const capture = captures.get(name);
  if (!capture) return;
  capture.stop();
  forget(capture);
}

// `stream` reuses an open stream instead of asking the browser for a new one.
export async function startAudio(
  name: string,
  source: AudioSource,
  stream?: MediaStream
): Promise<void> {
  const capture: RunningAudio = {
    kind: 'audio',
    name,
    source,
    stream: null,
    levels: new Set(),
    stop: () => undefined
  };
  const stopsAtStart = stops.get(name);
  const handle = await startAudioCapture({
    pattern: () => serverFeed(capture),
    source,
    stream,
    onFrame: (bands, level) => {
      setAudioFrame(capture.name, [...bands], level);
      capture.levels.forEach((listener) => listener(level));
    },
    onEnded: () => forget(capture)
  });
  capture.stop = handle.stop;
  capture.stream = handle.stream;
  add(capture, stopsAtStart);
}

// Browsers may stop decoding into an element that is not in the page, so the capture's
// element stays in it, just out of sight.
function hiddenVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  Object.assign(video.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none'
  });
  document.body.append(video);
  return video;
}

export async function startVideo(
  name: string,
  source: VideoSource,
  sampling: number,
  geometry: VideoGeometry,
  stream?: MediaStream
): Promise<void> {
  const capture: RunningVideo = {
    kind: 'video',
    name,
    source,
    stream: null,
    sampling,
    geometry,
    strips: new Set(),
    stop: () => undefined
  };
  const stopsAtStart = stops.get(name);
  const video = hiddenVideo();
  try {
    const handle = await startVideoCapture({
      pattern: () => serverFeed(capture),
      source,
      stream,
      video,
      sampling: () => capture.sampling,
      geometry: () => capture.geometry,
      onStrip: (width, rgb) => {
        setVideoStrip(capture.name, width, rgb.slice(0, width * 3), 'browser');
        capture.strips.forEach((listener) => listener(width, rgb));
      },
      onEnded: () => {
        video.remove();
        forget(capture);
      }
    });
    capture.stream = video.srcObject as MediaStream | null;
    capture.stop = () => {
      handle.stop();
      video.remove();
    };
  } catch (e) {
    video.remove();
    throw e;
  }
  add(capture, stopsAtStart);
}

// Aim a running video capture without restarting it.
export function setVideoSettings(
  name: string,
  sampling: number,
  geometry: VideoGeometry
) {
  const capture = captures.get(name);
  if (capture?.kind !== 'video') return;
  capture.sampling = sampling;
  capture.geometry = geometry;
}

// Feed a copied pattern from the same source as the original, sharing its stream so the
// browser doesn't ask again.
export async function duplicateCapture(from: string, to: string): Promise<void> {
  const capture = captures.get(from);
  if (!capture?.stream) return;
  const stream = capture.stream.clone();
  if (capture.kind === 'audio') await startAudio(to, capture.source, stream);
  else await startVideo(to, capture.source, capture.sampling, capture.geometry, stream);
}

export function renameCapture(from: string, to: string) {
  const capture = captures.get(from);
  if (!capture || from === to) return;
  stopCapture(to);
  captures.delete(from);
  capture.name = to;
  captures.set(to, capture);
  changed();
}

// Stop the captures whose pattern is gone or now asks for another source, and aim the
// rest the way their pattern is saved. A draft is left to the dialog adding it.
export function syncCaptures(patterns: readonly PatternParameters[]) {
  for (const capture of [...captures.values()]) {
    if (capture.name === DRAFT_CAPTURE) continue;
    const pattern = patterns.find((p) => p.name === capture.name);
    if (capture.kind === 'audio') {
      if (
        pattern?.type !== AUDIO_TYPE ||
        audioSourceOf((pattern as AudioParameters).input) !== capture.source
      ) {
        stopCapture(capture.name);
      }
      continue;
    }

    const settings = pattern?.type === VIDEO_TYPE ? videoCaptureOf(pattern) : null;
    if (settings === null || videoSourceOf(settings.input) !== capture.source) {
      stopCapture(capture.name);
    } else {
      setVideoSettings(capture.name, settings.sampling, settings.geometry);
    }
  }
}
