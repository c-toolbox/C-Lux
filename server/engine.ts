import { type Color, Pattern } from '../shared/patterns/pattern';
import {
  patternByType,
  patternFromParameters,
  type PatternParameters,
  type PatternProps,
  type Scene
} from '../shared/patterns/patterns';
import { SOLID_COLOR_NAME, StaticPattern } from '../shared/patterns/static';

import { config } from './config';
import { HttpError } from './errors';
import { loadPatterns, loadScenes, savePatterns, saveScenes } from './storage';
import {
  validateName,
  validateNewPatternProps,
  validateUpdatedPatternProps
} from './validation';

// How long to wait after the last change before writing patterns to disk. Coalesces
// bursts of edits (drag-reorder, slider drags) into a single write.
const SAVE_DEBOUNCE_MS = 250;

// The color the hardcoded layer starts on, until one is set and persisted.
const SOLID_COLOR_DEFAULT: Color = StaticPattern.Fields.color.default;

type FrameListener = (frame: number[]) => void;

// State of the hardcoded solid color layer: whether it is showing, the color on the
// lights right now and, while it is interpolating, where it is heading.
export interface SolidColorStatus {
  enabled: boolean;
  color: Color;
  target: Color;
  fading: boolean;
}

// A change to that layer; omitted fields are left alone.
export interface SolidColorUpdate {
  color?: Color;
  enabled?: boolean;
}

// Durability of the active pattern list on disk.
export interface PersistenceStatus {
  ok: boolean; // the last write attempt succeeded
  pending: boolean; // changes not yet written to disk
  error: string | null; // message from the last failed write
  lastSavedAt: string | null;
}

// Owns all mutable server state (patterns, scenes, pause/blackout) and the logic that
// ticks animations, blends layers, persists to disk, and broadcasts frames.
export class Engine {
  private patterns: Array<Pattern> = [];
  private scenes: Array<Scene> = [];

  // The hardcoded bottom layer. It is kept out of `patterns` so it never shows up in
  // the editor or in a saved scene, and is composited under them by `blend()`.
  private solidColor = new StaticPattern({
    name: SOLID_COLOR_NAME,
    enabled: false,
    ...SOLID_COLOR_DEFAULT
  });

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

  // Serialized disk writer for the scenes; scene edits are rare, so they're written
  // immediately instead of debounced.
  private savingScenes: Promise<void> = Promise.resolve();

  private frameListeners = new Set<FrameListener>();

  // Reused scratch buffers for blend() so a fresh array isn't allocated every tick; every
  // caller consumes the result synchronously (serializes or copies it) before blend() can
  // be called again, so sharing these buffers across calls is safe.
  private readonly blendAccum: number[] = new Array<number>(config.nLights * 3).fill(0);
  private readonly blendOut: number[] = new Array<number>(config.nLights * 3).fill(0);

  // Restore any patterns and scenes saved from a previous run. The solid color layer is
  // stored with the patterns under its reserved name, so it is lifted back out here;
  // scenes saved before it moved out of the list may still carry it, and must not
  // resurrect it as an ordinary pattern.
  async load(): Promise<void> {
    const stored = await loadPatterns();
    const saved = stored.find((p) => p.name === SOLID_COLOR_NAME);
    if (saved instanceof StaticPattern) this.solidColor = saved;
    this.patterns = stored.filter((p) => p.name !== SOLID_COLOR_NAME);

    this.scenes = (await loadScenes()).map((scene) => ({
      ...scene,
      patterns: scene.patterns.filter((p) => p.name !== SOLID_COLOR_NAME)
    }));
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
    const snapshot = [this.solidColor, ...this.patterns];
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
    return this.patterns.map((p) => p.serialize() as PatternParameters);
  }

  // Props arrive as an untyped record from the HTTP boundary; `validateName` and
  // `validateNewPatternProps` narrow them before the pattern is constructed.
  addPattern(type: string, props: Record<string, unknown>): { name: string } {
    const name = validateName(props.name, 'pattern name');

    if (name === SOLID_COLOR_NAME) {
      throw new HttpError(400, `${SOLID_COLOR_NAME} is a reserved pattern name`);
    }

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

  // Drop every pattern, leaving only the hardcoded solid color layer under them.
  clearPatterns(): PatternParameters[] {
    this.patterns = [];
    this.schedulePersist();
    return this.listPatterns();
  }

  updatePattern(name: string, props: Record<string, unknown>): PatternParameters {
    const instance = this.patterns.find((p) => p.name === name);
    if (!instance) throw new HttpError(404, `No pattern named: ${name}`);

    const { type } = instance.parameters() as PatternParameters;
    instance.set(validateUpdatedPatternProps(type, props));
    this.schedulePersist();
    return instance.serialize() as PatternParameters;
  }

  // Disabled patterns stay in the list (and keep their place in the stack) but are
  // skipped when ticking and blending.
  setPatternEnabled(name: string, enabled: boolean): PatternParameters {
    const instance = this.patterns.find((p) => p.name === name);
    if (!instance) throw new HttpError(404, `No pattern named: ${name}`);

    instance.enabled = enabled;
    this.schedulePersist();
    return instance.serialize() as PatternParameters;
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
  // Solid color
  //

  solidColorStatus(): SolidColorStatus {
    const { color } = this.solidColor.parameters();
    return {
      enabled: this.solidColor.enabled,
      color: this.solidColor.color(),
      target: color,
      fading: this.solidColor.fading()
    };
  }

  // A new color eases in from whatever is currently lit over `solidColorTransition`
  // seconds; `enabled` switches the whole layer on or off.
  setSolidColor({ color, enabled }: SolidColorUpdate): SolidColorStatus {
    if (color) this.solidColor.fadeTo(color, config.server.solidColorTransition);
    if (enabled !== undefined) this.solidColor.enabled = enabled;
    this.schedulePersist();
    return this.solidColorStatus();
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
  // Scenes
  //

  listScenes(): Scene[] {
    return this.scenes;
  }

  async saveScene(rawName: unknown): Promise<Scene[]> {
    const name = validateName(rawName, 'scene name');

    const scene: Scene = {
      name,
      patterns: this.patterns.map((p) => p.serialize() as PatternParameters)
    };

    const index = this.scenes.findIndex((s) => s.name === name);
    if (index === -1) this.scenes.push(scene);
    else this.scenes[index] = scene;

    await this.persistScenes('save');
    return this.scenes;
  }

  applyScene(name: string): PatternParameters[] {
    const scene = this.scenes.find((s) => s.name === name);
    if (!scene) throw new HttpError(404, `No scene named: ${name}`);

    const existing = new Set(this.patterns.map((p) => p.name));
    for (const params of scene.patterns) {
      if (existing.has(params.name)) continue;

      const instance = patternFromParameters(params);
      if (!instance) {
        console.warn(`Skipping unknown pattern type: ${params.type}`);
        continue;
      }

      this.patterns.push(instance);
      existing.add(instance.name);
    }

    this.sortBySceneOrder();
    this.schedulePersist();
    return this.listPatterns();
  }

  // Composite applied scenes in the order they appear in the scene list rather than the
  // order they were applied. Patterns belonging to no scene keep their order, on top.
  private sortBySceneOrder(): void {
    const rank = new Map<string, number>();
    this.scenes.forEach((scene, index) => {
      for (const params of scene.patterns) {
        if (!rank.has(params.name)) rank.set(params.name, index);
      }
    });

    const unranked = this.scenes.length;
    const rankOf = (name: string) => rank.get(name) ?? unranked;

    this.patterns = this.patterns
      .map((pattern, index) => ({ pattern, index }))
      .sort(
        (a, b) => rankOf(a.pattern.name) - rankOf(b.pattern.name) || a.index - b.index
      )
      .map((e) => e.pattern);
  }

  // Drop the patterns belonging to a scene, leaving any other active pattern running.
  unapplyScene(name: string): PatternParameters[] {
    const scene = this.scenes.find((s) => s.name === name);
    if (!scene) throw new HttpError(404, `No scene named: ${name}`);

    const names = new Set(scene.patterns.map((p) => p.name));
    const remaining = this.patterns.filter((p) => !names.has(p.name));
    if (remaining.length !== this.patterns.length) {
      this.patterns = remaining;
      this.schedulePersist();
    }

    return this.listPatterns();
  }

  // Swap the active list for a scene. Every pattern is built before anything is
  // discarded, so a missing scene or an unusable entry leaves the current list untouched
  // instead of half-cleared.
  replaceWithScene(name: string): PatternParameters[] {
    const scene = this.scenes.find((s) => s.name === name);
    if (!scene) throw new HttpError(404, `No scene named: ${name}`);

    const replacement: Array<Pattern> = [];
    for (const params of scene.patterns) {
      const instance = patternFromParameters(params);
      if (!instance) {
        throw new HttpError(
          500,
          `Scene ${name} uses an unknown pattern type: ${params.type}`
        );
      }
      replacement.push(instance);
    }

    this.patterns = replacement;
    this.schedulePersist();
    return this.listPatterns();
  }

  async reorderScenes(order: unknown): Promise<Scene[]> {
    if (!Array.isArray(order) || order.length !== this.scenes.length) {
      throw new HttpError(400, 'order must list every existing scene name once');
    }

    const byName = new Map(this.scenes.map((s) => [s.name, s]));
    const reordered: Scene[] = [];
    for (const name of order) {
      if (typeof name !== 'string') {
        throw new HttpError(400, 'order must contain only scene names');
      }
      const scene = byName.get(name);
      if (!scene) {
        throw new HttpError(400, `Unknown or duplicate scene name: ${name}`);
      }
      byName.delete(name);
      reordered.push(scene);
    }

    this.scenes = reordered;
    await this.persistScenes('reorder');
    return this.scenes;
  }

  async renameScene(name: string, newName: unknown): Promise<Scene[]> {
    const trimmed = validateName(newName, 'new name for scene');

    const index = this.scenes.findIndex((s) => s.name === name);
    if (index === -1) throw new HttpError(404, `No scene named: ${name}`);

    if (trimmed !== name && this.scenes.some((s) => s.name === trimmed)) {
      throw new HttpError(400, `A scene named ${trimmed} already exists`);
    }

    this.scenes[index] = { ...this.scenes[index], name: trimmed };

    await this.persistScenes('rename');
    return this.scenes;
  }

  async deleteScene(name: string): Promise<{ name: string }> {
    const index = this.scenes.findIndex((s) => s.name === name);
    if (index === -1) throw new HttpError(404, `No scene named: ${name}`);

    this.scenes.splice(index, 1);

    await this.persistScenes('delete');
    return { name };
  }

  // Queue a scene write behind any write already in flight, persisting the snapshot
  // taken when the caller mutated the scenes so concurrent requests can't interleave or
  // land out of order.
  private persistScenes(action: string): Promise<void> {
    const snapshot = this.scenes.slice();
    const write = this.savingScenes.then(() => saveScenes(snapshot));

    // Swallow the failure on the queue itself so one bad write doesn't reject every
    // later one; the caller still sees it through the returned promise.
    this.savingScenes = write.catch(() => undefined);

    return write.catch((err: unknown) => {
      console.error('Failed to save scenes:', err);
      throw new HttpError(500, `Failed to ${action} scene`);
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

    if (this.solidColor.enabled) this.composite(this.solidColor, accum);
    for (const p of this.patterns) {
      if (!p.enabled) continue;
      this.composite(p, accum);
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

  // Source-over composite one pattern's layer onto the accumulator.
  private composite(pattern: Pattern, accum: number[]): void {
    const layer = pattern.data();
    for (let i = 0; i < config.nLights; i++) {
      const src = i * 4;
      const dst = i * 3;
      const alpha = layer[src + 3];

      accum[dst] = layer[src] * alpha + accum[dst] * (1 - alpha);
      accum[dst + 1] = layer[src + 1] * alpha + accum[dst + 1] * (1 - alpha);
      accum[dst + 2] = layer[src + 2] * alpha + accum[dst + 2] * (1 - alpha);
    }
  }

  // Advance every pattern and ease the pause/brightness factors toward their targets.
  tick(dt: number): void {
    this.pauseFactor = approach(
      this.pauseFactor,
      this.serverPaused ? 0 : 1,
      dt,
      config.server.pauseTransition
    );

    const scaledDt = dt * this.pauseFactor;
    for (const p of this.patterns) if (p.enabled) p.tick(scaledDt);

    // Color fades are transitions rather than animation, so they run even while paused.
    this.solidColor.tick(dt);

    this.brightnessFactor = approach(
      this.brightnessFactor,
      this.blackout ? 0 : 1,
      dt,
      config.server.blackoutTransition
    );

    this.halfLightFactor = approach(
      this.halfLightFactor,
      this.halfLight ? 1 : 0,
      dt,
      config.server.halfLightTransition
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
  const feather = Math.max(1e-6, config.server.halfLightFeather);
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
