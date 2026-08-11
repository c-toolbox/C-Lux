export type {
  Color,
  MovingGaussianProps,
  PatternParameters,
  PatternProps,
  PatternType,
  SparkleProps,
  StaticProps,
  StoredPatternSet
} from '../../server/patterns/patterns';
export { PATTERN_TYPES } from '../../server/patterns/patterns';
export { patternDisplayName } from '../../server/patterns/patterns';

import type {
  PatternParameters,
  PatternProps,
  PatternType,
  StoredPatternSet
} from '../../server/patterns/patterns';

async function request<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
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

export const api = {
  listPatterns: () => request<PatternParameters[]>('/current_patterns'),
  addPattern: (type: PatternType, props: PatternProps) =>
    request<{ name: string }>('/add_new_pattern', { type, props }),
  updatePattern: (name: string, props: Partial<PatternProps>) =>
    request<PatternParameters>('/update_pattern', { name, props }),
  serverPaused: () => request<{ paused: boolean }>('/server_paused'),
  setServerPaused: (paused: boolean) =>
    request<{ paused: boolean }>('/set_server_paused', { paused }),
  blackout: () => request<{ blackout: boolean }>('/blackout'),
  setBlackout: (blackout: boolean) =>
    request<{ blackout: boolean }>('/set_blackout', { blackout }),
  removePattern: (name: string) =>
    request<{ name: string }>('/remove_new_pattern', { name }),
  reorderPatterns: (order: string[]) => request<string[]>('/reorder_patterns', { order }),
  getPattern: () => request<number[]>('/pattern'),
  storedPatterns: () => request<StoredPatternSet[]>('/stored_patterns'),
  storePatterns: (name: string) =>
    request<StoredPatternSet[]>('/store_patterns', { name }),
  addStoredPatterns: (name: string) =>
    request<PatternParameters[]>('/add_stored_patterns', { name }),
  renameStoredPattern: (name: string, newName: string) =>
    request<StoredPatternSet[]>('/rename_stored_pattern', { name, newName }),
  removeStoredPattern: (name: string) =>
    request<{ name: string }>('/remove_stored_pattern', { name })
};
