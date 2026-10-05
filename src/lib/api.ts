export type {
  ArtNetSettings,
  ConfigSaved,
  ConfigStatus,
  ConfigUpdate,
  OutputSettings,
  ServerSettings,
  Settings
} from '../../shared/config';
export type { DebugStatus, DebugUpdate } from '../../shared/debug';
export type { NdiSource, NdiStatus } from '../../shared/ndi';
export {
  AUDIO_INPUT_DEVICE,
  AUDIO_INPUT_SYSTEM,
  AUDIO_TYPE,
  type AudioParameters
} from '../../shared/patterns/audio';
export type {
  Color,
  ColorStop,
  FieldSpec,
  PatternParameters,
  PatternProps,
  PatternSchema,
  PatternType,
  Scene
} from '../../shared/patterns/patterns';
export {
  isFieldVisible,
  MAX_COLORS,
  PATTERN_TYPES,
  sampleColorMap,
  SCENE_EXPORT_VERSION
} from '../../shared/patterns/patterns';
export {
  patternByType,
  patternDisplayName,
  patternFields
} from '../../shared/patterns/patterns';
export type { SolidColorStatus, SolidColorUpdate } from '../../shared/patterns/static';
export {
  VIDEO_TYPE,
  videoCaptureOf,
  type VideoParameters
} from '../../shared/patterns/video';
export { REMAP_DISABLED } from '../../shared/remap';
export {
  type Clip,
  gateAt,
  MAX_TIMELINE_DURATION,
  type Timeline,
  type TimelinePlayback,
  trackOf,
  wrapTime
} from '../../shared/timeline';

import type { ConfigSaved, ConfigStatus, ConfigUpdate } from '../../shared/config';
import type { DebugStatus, DebugUpdate } from '../../shared/debug';
import {
  NDI_PREVIEW_HEADER_BYTES,
  type NdiSource,
  type NdiStatus
} from '../../shared/ndi';
import type {
  PatternParameters,
  PatternProps,
  PatternType,
  Scene
} from '../../shared/patterns/patterns';
import type { SolidColorStatus, SolidColorUpdate } from '../../shared/patterns/static';
import type { Timeline, TimelinePlayback } from '../../shared/timeline';

import { authHeaders, editorToken, signOut } from './auth';

async function request<T>(
  url: string,
  method: string = 'GET',
  body?: unknown
): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: {
      ...authHeaders(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!res.ok) {
    // A token the server no longer honours (expired, or lost to a restart) has to go, so
    // the editor stops retrying with it and asks for the password again.
    if (res.status === 401 && editorToken() !== null) signOut();

    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;

  return (await res.json()) as T;
}

// Encode a pattern/scene name for safe use in a URL path segment.
const seg = (name: string) => encodeURIComponent(name);

export const api = {
  // Whether the token this tab is holding still unlocks the editor-only endpoints, and
  // whether a password is configured at all.
  authStatus: () => request<{ authenticated: boolean; required: boolean }>('/auth'),
  login: (password: string) =>
    request<{ token: string }>('/auth/login', 'POST', { password }),
  logout: () => request<void>('/auth/logout', 'POST'),
  listPatterns: () => request<PatternParameters[]>('/patterns'),
  addPattern: (type: PatternType, props: PatternProps) =>
    request<{ name: string }>('/patterns', 'POST', { type, props }),
  // `overwrite` lets a rename replace the pattern already holding the new name.
  updatePattern: (name: string, props: Partial<PatternProps>, overwrite = false) =>
    request<PatternParameters>(`/patterns/${seg(name)}`, 'PATCH', { props, overwrite }),
  setPatternEnabled: (name: string, enabled: boolean) =>
    request<PatternParameters>(`/patterns/${seg(name)}/enabled`, 'PUT', { enabled }),
  blackout: () => request<{ blackout: boolean }>('/blackout'),
  setBlackout: (blackout: boolean) =>
    request<{ blackout: boolean }>('/blackout', 'PUT', { blackout }),
  halfLight: () => request<{ halfLight: boolean }>('/half-light'),
  setHalfLight: (halfLight: boolean) =>
    request<{ halfLight: boolean }>('/half-light', 'PUT', { halfLight }),
  solidColor: () => request<SolidColorStatus>('/solid-color'),
  // A new color eases in from the one currently lit; the response reports the target.
  setSolidColor: (update: SolidColorUpdate) =>
    request<SolidColorStatus>('/solid-color', 'PUT', update),
  // The debug page's overrides on the output. Editor-only, and never persisted.
  debug: () => request<DebugStatus>('/debug'),
  setDebug: (update: DebugUpdate) => request<DebugStatus>('/debug', 'PUT', update),
  // The NDI receiver the server runs for a Video pattern, and the senders it can see.
  ndi: (pattern: string) => request<NdiStatus>(`/patterns/${seg(pattern)}/ndi`),
  ndiSources: () => request<NdiSource[]>('/ndi/sources'),
  removePattern: (name: string) =>
    request<{ name: string }>(`/patterns/${seg(name)}`, 'DELETE'),
  reorderPatterns: (order: string[]) =>
    request<string[]>('/patterns/reorder', 'POST', { order }),
  // Leaves only the hardcoded solid-color layer running.
  clearPatterns: () => request<PatternParameters[]>('/patterns/clear', 'POST'),
  listScenes: () => request<Scene[]>('/scenes'),
  // The names of the scenes currently switched on.
  appliedScenes: () => request<string[]>('/scenes/applied'),
  saveScene: (name: string) => request<Scene[]>('/scenes', 'POST', { name }),
  // Add a scene read from a JSON file; the server re-validates it and renames it if the
  // name is already taken.
  importScene: (scene: unknown) => request<Scene[]>('/scenes/import', 'POST', scene),
  // The scene endpoints below all answer with the applied scene names after the change.
  applyScene: (name: string) => request<string[]>(`/scenes/${seg(name)}/apply`, 'POST'),
  // Remove just this scene's patterns, leaving any other applied scene intact.
  unapplyScene: (name: string) =>
    request<string[]>(`/scenes/${seg(name)}/unapply`, 'POST'),
  // Swap the active patterns for a scene in a single, all-or-nothing request.
  replaceWithScene: (name: string) =>
    request<string[]>(`/scenes/${seg(name)}/replace`, 'POST'),
  reorderScenes: (order: string[]) =>
    request<Scene[]>('/scenes/reorder', 'POST', { order }),
  // `overwrite` lets the rename replace the scene already holding the new name.
  renameScene: (name: string, newName: string, overwrite = false) =>
    request<Scene[]>(`/scenes/${seg(name)}`, 'PATCH', { newName, overwrite }),
  deleteScene: (name: string) =>
    request<{ name: string }>(`/scenes/${seg(name)}`, 'DELETE'),
  // Where the timelines of the scenes switched on are at.
  timelines: () => request<TimelinePlayback[]>('/scenes/timelines'),
  // Replace the timeline a scene is playing; saving the scene keeps it.
  setTimeline: (scene: string, timeline: Timeline) =>
    request<TimelinePlayback[]>(`/scenes/${seg(scene)}/timeline`, 'PUT', timeline),
  // Stop a scene's timeline; saving the scene drops it.
  removeTimeline: (scene: string) =>
    request<TimelinePlayback[]>(`/scenes/${seg(scene)}/timeline`, 'DELETE'),
  controlTimeline: (scene: string, control: { playing?: boolean; time?: number }) =>
    request<TimelinePlayback[]>(
      `/scenes/${seg(scene)}/timeline/playback`,
      'PUT',
      control
    ),
  // config.json, minus the edit password. Editor-only.
  config: () => request<ConfigStatus>('/config'),
  // Rewrite config.json. The server adopts what it can read live and reports the settings
  // that are waiting for a restart.
  saveConfig: (update: ConfigUpdate) => request<ConfigSaved>('/config', 'PUT', update)
};

// Subscribe to the live blended frame over Server-Sent Events. Calls `onFrame` with each
// frame; the browser reconnects automatically if the stream drops. Returns a cleanup
// function that closes the connection.
export function subscribeFrames(onFrame: (frame: number[]) => void): () => void {
  const source = new EventSource('/api/stream');
  source.onmessage = (event: MessageEvent<string>) => {
    try {
      onFrame(JSON.parse(event.data) as number[]);
    } catch {
      // Ignore malformed frames.
    }
  };
  return () => source.close();
}

export interface NdiPreview {
  width: number;
  height: number;
  rgb: Uint8Array;
  strip: Uint8Array;
}

// One frame of what the NDI receiver for a Video pattern is reading, plus the strip it
// sampled from it. Binary rather than JSON, for the same reason the capture ingest is.
// Resolves to null until the receiver has rendered a preview.
export async function ndiPreview(
  pattern: string,
  signal?: AbortSignal
): Promise<NdiPreview | null> {
  const res = await fetch(`/api/patterns/${seg(pattern)}/ndi/preview`, {
    headers: authHeaders(),
    signal
  });
  if (res.status === 204 || !res.ok) return null;

  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length < NDI_PREVIEW_HEADER_BYTES) return null;

  const header = new DataView(body.buffer, body.byteOffset, NDI_PREVIEW_HEADER_BYTES);
  const width = header.getUint16(0, true);
  const height = header.getUint16(2, true);
  const stripWidth = header.getUint16(4, true);

  const pixels = width * height * 3;
  if (body.length !== NDI_PREVIEW_HEADER_BYTES + pixels + stripWidth * 3) return null;

  return {
    width,
    height,
    rgb: body.subarray(NDI_PREVIEW_HEADER_BYTES, NDI_PREVIEW_HEADER_BYTES + pixels),
    strip: body.subarray(NDI_PREVIEW_HEADER_BYTES + pixels)
  };
}
