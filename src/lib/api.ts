export type {
  Color,
  FieldSpec,
  MovingGaussianProps,
  PatternParameters,
  PatternProps,
  PatternSchema,
  PatternType,
  SparkleProps,
  StaticProps,
  StoredPatternSet
} from '../../server/patterns/patterns';
export { PATTERN_TYPES } from '../../server/patterns/patterns';
export { patternByType, patternDisplayName } from '../../server/patterns/patterns';

import type {
  PatternParameters,
  PatternProps,
  PatternType,
  StoredPatternSet
} from '../../server/patterns/patterns';

async function request<T>(
  url: string,
  method: string = 'GET',
  body?: unknown
): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

// Encode a pattern/set name for safe use in a URL path segment.
const seg = (name: string) => encodeURIComponent(name);

export const api = {
  listPatterns: () => request<PatternParameters[]>('/patterns'),
  addPattern: (type: PatternType, props: PatternProps) =>
    request<{ name: string }>('/patterns', 'POST', { type, props }),
  updatePattern: (name: string, props: Partial<PatternProps>) =>
    request<PatternParameters>(`/patterns/${seg(name)}`, 'PATCH', { props }),
  serverPaused: () => request<{ paused: boolean }>('/pause'),
  setServerPaused: (paused: boolean) =>
    request<{ paused: boolean }>('/pause', 'PUT', { paused }),
  blackout: () => request<{ blackout: boolean }>('/blackout'),
  setBlackout: (blackout: boolean) =>
    request<{ blackout: boolean }>('/blackout', 'PUT', { blackout }),
  halfLight: () => request<{ halfLight: boolean }>('/half-light'),
  setHalfLight: (halfLight: boolean) =>
    request<{ halfLight: boolean }>('/half-light', 'PUT', { halfLight }),
  removePattern: (name: string) =>
    request<{ name: string }>(`/patterns/${seg(name)}`, 'DELETE'),
  reorderPatterns: (order: string[]) =>
    request<string[]>('/patterns/reorder', 'POST', { order }),
  getPattern: () => request<number[]>('/frame'),
  // Force the server's debounced save and surface a disk failure as a rejected promise.
  persistPatterns: () => request<{ ok: boolean; pending: boolean }>('/persist', 'POST'),
  storedPatterns: () => request<StoredPatternSet[]>('/library'),
  storePatterns: (name: string) =>
    request<StoredPatternSet[]>('/library', 'POST', { name }),
  addStoredPatterns: (name: string) =>
    request<PatternParameters[]>(`/library/${seg(name)}/apply`, 'POST'),
  // Swap the active patterns for a stored set in a single, all-or-nothing request.
  replaceWithStoredPatterns: (name: string) =>
    request<PatternParameters[]>(`/library/${seg(name)}/replace`, 'POST'),
  renameStoredPattern: (name: string, newName: string) =>
    request<StoredPatternSet[]>(`/library/${seg(name)}`, 'PATCH', { newName }),
  removeStoredPattern: (name: string) =>
    request<{ name: string }>(`/library/${seg(name)}`, 'DELETE')
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
