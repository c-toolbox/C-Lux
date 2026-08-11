import config from '../config.json' with { type: 'json' };

import { Pattern } from './patterns/pattern';
import {
  patternByType,
  patternFromParameters,
  type PatternParameters,
  type PatternProps,
  type StoredPatternSet
} from './patterns/patterns';
import { HttpError } from './errors';
import { loadLibrary, loadPatterns, saveLibrary, savePatterns } from './storage';

// How long to wait after the last change before writing patterns to disk. Coalesces
// bursts of edits (drag-reorder, slider drags) into a single write.
const SAVE_DEBOUNCE_MS = 250;

type FrameListener = (frame: number[]) => void;

// Owns all mutable server state (patterns, library, pause/blackout) and the logic that
// ticks animations, blends layers, persists to disk, and broadcasts frames.
export class PatternEngine {
  private patterns: Array<Pattern> = [];
  private library: Array<StoredPatternSet> = [];

  // Global pause. `pauseFactor` scales the tick dt and eases between 1 (running) and 0
  // (paused) so animations ramp in and out instead of snapping.
  private serverPaused = false;
  private pauseFactor = 1;

  // Master blackout. `brightnessFactor` scales the output and eases between 1 (full) and
  // 0 (black) so the lights fade rather than snap.
  private blackout = false;
  private brightnessFactor = 1;

  // Debounced, serialized disk writer for the active pattern list.
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> = Promise.resolve();

  private frameListeners = new Set<FrameListener>();

  // Restore any patterns and library saved from a previous run.
  async load(): Promise<void> {
    this.patterns = await loadPatterns();
    this.library = await loadLibrary();
  }

  // Schedule a debounced write, capturing the latest state at flush time and keeping at
  // most one write in flight so concurrent writes can't interleave.
  private schedulePersist(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const snapshot = this.patterns.slice();
      this.saving = this.saving
        .then(() => savePatterns(snapshot))
        .catch((err) => console.error('Failed to save patterns:', err));
    }, SAVE_DEBOUNCE_MS);
  }

  //
  // Patterns
  //

  listPatterns(): PatternParameters[] {
    return this.patterns.map((p) => p.parameters() as PatternParameters);
  }

  addPattern(type: string, props: PatternProps & { name?: string }): { name: string } {
    const { name } = props ?? {};
    if (!name) throw new HttpError(400, 'Missing name for new pattern');

    if (this.patterns.find((p) => p.name === name)) {
      throw new HttpError(400, `A pattern named ${name} already exists`);
    }

    const cls = patternByType(type);
    if (!cls) throw new HttpError(400, `Unknown pattern type: ${type}`);

    const instance = new cls(props);
    this.patterns.push(instance);
    this.schedulePersist();
    return { name: instance.name };
  }

  removePattern(name: string): { name: string } {
    const index = this.patterns.findIndex((p) => p.name === name);
    if (index === -1) throw new HttpError(404, `No pattern named: ${name}`);

    this.patterns.splice(index, 1);
    this.schedulePersist();
    return { name };
  }

  updatePattern(name: string, props: Partial<PatternProps>): PatternParameters {
    const instance = this.patterns.find((p) => p.name === name);
    if (!instance) throw new HttpError(404, `No pattern named: ${name}`);

    instance.set(props);
    this.schedulePersist();
    return instance.parameters() as PatternParameters;
  }

  reorderPatterns(order: unknown): string[] {
    if (!Array.isArray(order) || order.length !== this.patterns.length) {
      throw new HttpError(400, 'order must list every existing pattern name once');
    }

    const byName = new Map(this.patterns.map((p) => [p.name, p]));
    const reordered: Array<Pattern> = [];
    for (const name of order) {
      const instance = byName.get(name);
      if (!instance) {
        throw new HttpError(400, `Unknown or duplicate pattern name: ${name}`);
      }
      byName.delete(name);
      reordered.push(instance);
    }

    this.patterns = reordered;
    this.schedulePersist();
    return this.patterns.map((p) => p.name);
  }

  //
  // Pause / blackout
  //

  isPaused(): boolean {
    return this.serverPaused;
  }

  setPaused(paused: boolean): boolean {
    this.serverPaused = paused;
    return this.serverPaused;
  }

  isBlackout(): boolean {
    return this.blackout;
  }

  setBlackout(blackout: boolean): boolean {
    this.blackout = blackout;
    return this.blackout;
  }

  //
  // Library
  //

  getLibrary(): StoredPatternSet[] {
    return this.library;
  }

  async storeCurrent(name: unknown): Promise<StoredPatternSet[]> {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new HttpError(400, 'Missing name for stored pattern set');
    }

    const entry: StoredPatternSet = {
      name,
      patterns: this.patterns.map((p) => p.parameters() as PatternParameters)
    };

    const index = this.library.findIndex((e) => e.name === name);
    if (index === -1) this.library.push(entry);
    else this.library[index] = entry;

    await this.persistLibrary('store');
    return this.library;
  }

  addStored(name: string): PatternParameters[] {
    const entry = this.library.find((e) => e.name === name);
    if (!entry) throw new HttpError(404, `No stored pattern set named: ${name}`);

    const existing = new Set(this.patterns.map((p) => p.name));
    for (const params of entry.patterns) {
      if (existing.has(params.name)) continue;

      const instance = patternFromParameters(params);
      if (!instance) {
        console.warn(`Skipping unknown stored pattern type: ${params.type}`);
        continue;
      }

      this.patterns.push(instance);
      existing.add(instance.name);
    }

    this.schedulePersist();
    return this.listPatterns();
  }

  async renameStored(name: string, newName: unknown): Promise<StoredPatternSet[]> {
    if (typeof newName !== 'string' || newName.trim() === '') {
      throw new HttpError(400, 'Missing new name for stored pattern set');
    }

    const trimmed = newName.trim();

    const index = this.library.findIndex((e) => e.name === name);
    if (index === -1) throw new HttpError(404, `No stored pattern set named: ${name}`);

    if (trimmed !== name && this.library.some((e) => e.name === trimmed)) {
      throw new HttpError(400, `A stored pattern set named ${trimmed} already exists`);
    }

    this.library[index] = { ...this.library[index], name: trimmed };

    await this.persistLibrary('rename');
    return this.library;
  }

  async removeStored(name: string): Promise<{ name: string }> {
    const index = this.library.findIndex((e) => e.name === name);
    if (index === -1) throw new HttpError(404, `No stored pattern set named: ${name}`);

    this.library.splice(index, 1);

    await this.persistLibrary('remove');
    return { name };
  }

  private async persistLibrary(action: string): Promise<void> {
    try {
      await saveLibrary(this.library);
    } catch (err) {
      console.error('Failed to save library:', err);
      throw new HttpError(500, `Failed to ${action} stored pattern`);
    }
  }

  //
  // Animation and output
  //

  // Blend the individual patterns into a single flat RGB array using source-over alpha
  // compositing (first pattern on the bottom, last on top), scaled by the master
  // brightness.
  blend(): number[] {
    const layers = this.patterns.map((p) => p.data());
    const { nLights } = config;
    const out = new Array<number>(nLights * 3).fill(0);

    for (const layer of layers) {
      for (let i = 0; i < nLights; i++) {
        const src = i * 4;
        const dst = i * 3;
        const alpha = layer[src + 3];

        out[dst] = layer[src] * alpha + out[dst] * (1 - alpha);
        out[dst + 1] = layer[src + 1] * alpha + out[dst + 1] * (1 - alpha);
        out[dst + 2] = layer[src + 2] * alpha + out[dst + 2] * (1 - alpha);
      }
    }

    return out.map((v) => Math.round(v * this.brightnessFactor));
  }

  // Advance every pattern and ease the pause/brightness factors toward their targets.
  tick(dt: number): void {
    this.pauseFactor = approach(
      this.pauseFactor,
      this.serverPaused ? 0 : 1,
      dt,
      config.server['pause-transition']
    );

    const scaledDt = dt * this.pauseFactor;
    for (const p of this.patterns) p.tick(scaledDt);

    this.brightnessFactor = approach(
      this.brightnessFactor,
      this.blackout ? 0 : 1,
      dt,
      config.server['blackout-transition']
    );

    if (this.frameListeners.size > 0) {
      const frame = this.blend();
      for (const listener of this.frameListeners) listener(frame);
    }
  }

  // Register a listener notified with the blended frame on every tick. Returns an
  // unsubscribe function.
  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }
}

// Move `current` toward `target` by one frame, easing over `transition` seconds. A
// non-positive transition snaps immediately.
function approach(
  current: number,
  target: number,
  dt: number,
  transition: number
): number {
  const step = transition > 0 ? dt / transition : 1;
  if (current < target) return Math.min(target, current + step);
  if (current > target) return Math.max(target, current - step);
  return current;
}
