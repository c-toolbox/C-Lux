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
import {
  validateName,
  validateNewPatternProps,
  validateUpdatedPatternProps
} from './validation';

// How long to wait after the last change before writing patterns to disk. Coalesces
// bursts of edits (drag-reorder, slider drags) into a single write.
const SAVE_DEBOUNCE_MS = 250;

type FrameListener = (frame: number[]) => void;

// Durability of the active pattern list on disk.
export interface PersistenceStatus {
  ok: boolean; // the last write attempt succeeded
  pending: boolean; // changes not yet written to disk
  error: string | null; // message from the last failed write
  lastSavedAt: string | null;
}

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

  // Half-light mode. When on, the top half of the ring is blacked out. `halfLightFactor`
  // eases between 0 (off) and 1 (fully applied) so the transition fades instead of
  // snapping. `halfLightMask[i]` is how dark light i gets when fully applied (1 = fully
  // dark at the top, 0 = untouched at the bottom), interpolated across the seam.
  private halfLight = false;
  private halfLightFactor = 0;
  private readonly halfLightMask: number[] = buildHalfLightMask();

  // Debounced, serialized disk writer for the active pattern list.
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> = Promise.resolve();

  // Durability bookkeeping: `changeCount` bumps on every mutation and `savedCount`
  // catches up once a write lands, so unsaved changes and the last failure can be
  // reported instead of only logged.
  private changeCount = 0;
  private savedCount = 0;
  private persistError: string | null = null;
  private lastPersistedAt: string | null = null;

  // Serialized disk writer for the library; library edits are rare, so they're written
  // immediately instead of debounced.
  private savingLibrary: Promise<void> = Promise.resolve();

  private frameListeners = new Set<FrameListener>();

  // Reused scratch buffers for blend() so a fresh array isn't allocated every tick; every
  // caller consumes the result synchronously (serializes or copies it) before blend() can
  // be called again, so sharing these buffers across calls is safe.
  private readonly blendAccum: number[] = new Array<number>(config.nLights * 3).fill(0);
  private readonly blendOut: number[] = new Array<number>(config.nLights * 3).fill(0);

  // Restore any patterns and library saved from a previous run.
  async load(): Promise<void> {
    this.patterns = await loadPatterns();
    this.library = await loadLibrary();
  }

  // Schedule a debounced write, capturing the latest state at flush time and keeping at
  // most one write in flight so concurrent writes can't interleave.
  private schedulePersist(): void {
    this.changeCount++;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.persistNow(), SAVE_DEBOUNCE_MS);
  }

  // Queue a write behind any write already in flight and record its outcome. Never
  // rejects; failures are kept in `persistError` for `persistenceStatus()` to report.
  private persistNow(): Promise<void> {
    clearTimeout(this.saveTimer);
    const snapshot = this.patterns.slice();
    const version = this.changeCount;
    this.saving = this.saving.then(async () => {
      try {
        await savePatterns(snapshot);
        this.savedCount = Math.max(this.savedCount, version);
        this.persistError = null;
        this.lastPersistedAt = new Date().toISOString();
      } catch (err) {
        this.persistError = err instanceof Error ? err.message : String(err);
        console.error('Failed to save patterns:', err);
      }
    });
    return this.saving;
  }

  persistenceStatus(): PersistenceStatus {
    return {
      ok: this.persistError === null,
      pending: this.savedCount !== this.changeCount,
      error: this.persistError,
      lastSavedAt: this.lastPersistedAt
    };
  }

  // Write any pending changes immediately and fail loudly if they didn't reach the disk,
  // so a caller can confirm its mutation is durable rather than assume the debounced
  // write succeeded.
  async flushPersist(): Promise<PersistenceStatus> {
    if (this.savedCount !== this.changeCount) await this.persistNow();
    else await this.saving;

    const status = this.persistenceStatus();
    if (!status.ok) {
      throw new HttpError(500, `Changes applied but not saved to disk: ${status.error}`);
    }
    return status;
  }

  //
  // Patterns
  //

  listPatterns(): PatternParameters[] {
    return this.patterns.map((p) => p.parameters() as PatternParameters);
  }

  addPattern(type: string, props: PatternProps & { name?: string }): { name: string } {
    const name = validateName(props?.name, 'pattern name');

    if (this.patterns.find((p) => p.name === name)) {
      throw new HttpError(400, `A pattern named ${name} already exists`);
    }

    const cls = patternByType(type);
    if (!cls) throw new HttpError(400, `Unknown pattern type: ${type}`);

    const validProps = validateNewPatternProps(type, props);
    const instance = new cls({ ...validProps, name } as PatternProps);
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

    const { type } = instance.parameters() as PatternParameters;
    instance.set(validateUpdatedPatternProps(type, props));
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
      if (typeof name !== 'string') {
        throw new HttpError(400, 'order must contain only pattern names');
      }
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

  isHalfLight(): boolean {
    return this.halfLight;
  }

  setHalfLight(halfLight: boolean): boolean {
    this.halfLight = halfLight;
    return this.halfLight;
  }

  //
  // Library
  //

  getLibrary(): StoredPatternSet[] {
    return this.library;
  }

  async storeCurrent(rawName: unknown): Promise<StoredPatternSet[]> {
    const name = validateName(rawName, 'stored pattern set name');

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

  // Swap the active list for a stored set. Every pattern is built before anything is
  // discarded, so a missing set or an unusable entry leaves the current list untouched
  // instead of half-cleared.
  replaceWithStored(name: string): PatternParameters[] {
    const entry = this.library.find((e) => e.name === name);
    if (!entry) throw new HttpError(404, `No stored pattern set named: ${name}`);

    const replacement: Array<Pattern> = [];
    for (const params of entry.patterns) {
      const instance = patternFromParameters(params);
      if (!instance) {
        throw new HttpError(
          500,
          `Stored pattern set ${name} uses an unknown pattern type: ${params.type}`
        );
      }
      replacement.push(instance);
    }

    this.patterns = replacement;
    this.schedulePersist();
    return this.listPatterns();
  }

  async renameStored(name: string, newName: unknown): Promise<StoredPatternSet[]> {
    const trimmed = validateName(newName, 'new name for stored pattern set');

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

  // Queue a library write behind any write already in flight, persisting the snapshot
  // taken when the caller mutated the library so concurrent requests can't interleave or
  // land out of order.
  private persistLibrary(action: string): Promise<void> {
    const snapshot = this.library.slice();
    const write = this.savingLibrary.then(() => saveLibrary(snapshot));

    // Swallow the failure on the queue itself so one bad write doesn't reject every
    // later one; the caller still sees it through the returned promise.
    this.savingLibrary = write.catch(() => undefined);

    return write.catch((err: unknown) => {
      console.error('Failed to save library:', err);
      throw new HttpError(500, `Failed to ${action} stored pattern`);
    });
  }

  //
  // Animation and output
  //

  // Blend the individual patterns into a single flat RGB array using source-over alpha
  // compositing (first pattern on the bottom, last on top), scaled by the master
  // brightness. Returns a buffer reused across calls; consume it before calling again.
  blend(): number[] {
    const { nLights } = config;
    const accum = this.blendAccum;
    accum.fill(0);

    for (const p of this.patterns) {
      const layer = p.data();
      for (let i = 0; i < nLights; i++) {
        const src = i * 4;
        const dst = i * 3;
        const alpha = layer[src + 3];

        accum[dst] = layer[src] * alpha + accum[dst] * (1 - alpha);
        accum[dst + 1] = layer[src + 1] * alpha + accum[dst + 1] * (1 - alpha);
        accum[dst + 2] = layer[src + 2] * alpha + accum[dst + 2] * (1 - alpha);
      }
    }

    const out = this.blendOut;
    for (let i = 0; i < nLights; i++) {
      // Scale each light by the master brightness and, in half-light mode, dim the top of
      // the ring by the eased factor. The mask feathers the seam so the dark and lit
      // halves blend into each other instead of meeting at a hard edge.
      const mul =
        this.brightnessFactor * (1 - this.halfLightFactor * this.halfLightMask[i]);
      const dst = i * 3;
      out[dst] = Math.round(accum[dst] * mul);
      out[dst + 1] = Math.round(accum[dst + 1] * mul);
      out[dst + 2] = Math.round(accum[dst + 2] * mul);
    }
    return out;
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

    this.halfLightFactor = approach(
      this.halfLightFactor,
      this.halfLight ? 1 : 0,
      dt,
      config.server['half-light-transition']
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

// Build the per-light darkness mask for half-light mode. Lights are arranged in a ring
// (light 0 at the top, matching the visualizer), so vertical position is cos(2π·i/N):
// +1 at the top, -1 at the bottom. Darkness ramps from 1 (top) to 0 (bottom), feathered
// over a band around the horizontal midline so the dark and lit halves interpolate.
function buildHalfLightMask(): number[] {
  const { nLights } = config;
  const feather = Math.max(1e-6, config.server['half-light-feather']);
  const mask = new Array<number>(nLights);
  for (let i = 0; i < nLights; i++) {
    const vertical = Math.cos((2 * Math.PI * i) / nLights);
    mask[i] = Math.min(1, Math.max(0, 0.5 + vertical / feather));
  }
  return mask;
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
