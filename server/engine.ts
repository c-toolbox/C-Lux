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
import { loadScenes, saveScenes } from './storage';
import {
  validateName,
  validateNewPatternProps,
  validateUpdatedPatternProps
} from './validation';

// The color the hardcoded layer starts on, until one is set.
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

// Owns all mutable server state (patterns, scenes, pause/blackout) and the logic that
// ticks animations, blends layers, and broadcasts frames. The active pattern list is
// deliberately not persisted: it only outlives a restart once saved as a scene.
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

  // Serialized disk writer for the scenes; scene edits are rare, so they're written
  // immediately instead of debounced.
  private savingScenes: Promise<void> = Promise.resolve();

  private frameListeners = new Set<FrameListener>();

  // Reused scratch buffers for blend() so a fresh array isn't allocated every tick; every
  // caller consumes the result synchronously (serializes or copies it) before blend() can
  // be called again, so sharing these buffers across calls is safe.
  private readonly blendAccum: number[] = new Array<number>(config.nLights * 3).fill(0);
  private readonly blendOut: number[] = new Array<number>(config.nLights * 3).fill(0);

  // Restore the scenes saved by a previous run. Scenes saved before the solid color
  // layer moved out of the pattern list may still carry it, and must not resurrect it as
  // an ordinary pattern.
  async load(): Promise<void> {
    this.scenes = (await loadScenes()).map((scene) => ({
      ...scene,
      patterns: scene.patterns.filter((p) => p.name !== SOLID_COLOR_NAME)
    }));
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
    return { name: instance.name };
  }

  removePattern(name: string): { name: string } {
    const index = this.patterns.findIndex((p) => p.name === name);
    if (index === -1) throw new HttpError(404, `No pattern named: ${name}`);

    this.patterns.splice(index, 1);
    return { name };
  }

  // Drop every pattern, leaving only the hardcoded solid color layer under them.
  clearPatterns(): PatternParameters[] {
    this.patterns = [];
    return this.listPatterns();
  }

  updatePattern(name: string, props: Record<string, unknown>): PatternParameters {
    const instance = this.patterns.find((p) => p.name === name);
    if (!instance) throw new HttpError(404, `No pattern named: ${name}`);

    const { type } = instance.parameters() as PatternParameters;
    instance.set(validateUpdatedPatternProps(type, props));
    return instance.serialize() as PatternParameters;
  }

  // Disabled patterns stay in the list (and keep their place in the stack) but are
  // skipped when ticking and blending.
  setPatternEnabled(name: string, enabled: boolean): PatternParameters {
    const instance = this.patterns.find((p) => p.name === name);
    if (!instance) throw new HttpError(404, `No pattern named: ${name}`);

    instance.enabled = enabled;
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

  // Add a scene from an exported JSON file. The file is untrusted input, so every
  // pattern is re-validated and rebuilt through its own class here rather than stored as
  // given. A name clash gets a numeric suffix instead of overwriting the existing scene.
  async importScene(raw: unknown): Promise<Scene[]> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new HttpError(400, 'A scene must be an object');
    }

    const { name: rawName, patterns } = raw as Record<string, unknown>;
    const name = this.uniqueSceneName(validateName(rawName, 'scene name'));
    if (!Array.isArray(patterns)) {
      throw new HttpError(400, 'scene.patterns must be an array');
    }

    const seen = new Set<string>();
    const imported: PatternParameters[] = [];
    for (const entry of patterns) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new HttpError(400, 'scene.patterns must contain only objects');
      }

      const params = entry as Record<string, unknown>;
      const patternName = validateName(params.name, 'pattern name');
      // The solid color layer lives outside the pattern list and can't be resurrected
      // as an ordinary pattern.
      if (patternName === SOLID_COLOR_NAME) continue;
      if (seen.has(patternName)) {
        throw new HttpError(400, `Duplicate pattern name in scene: ${patternName}`);
      }

      const { type } = params;
      if (typeof type !== 'string') throw new HttpError(400, 'Missing pattern type');
      const cls = patternByType(type);
      if (!cls) throw new HttpError(400, `Unknown pattern type: ${type}`);
      if (params.enabled !== undefined && typeof params.enabled !== 'boolean') {
        throw new HttpError(400, 'props.enabled must be true or false');
      }

      const { enabled, ...rest } = params;
      const props = validateNewPatternProps(type, Pattern.propsFromParameters(rest));
      const instance = new cls({ ...props, name: patternName } as PatternProps);
      instance.enabled = enabled !== false;

      seen.add(patternName);
      imported.push(instance.serialize() as PatternParameters);
    }

    this.scenes.push({ name, patterns: imported });
    await this.persistScenes('import');
    return this.scenes;
  }

  // Append " 2", " 3", … until the name is free, so an import never clobbers a scene.
  private uniqueSceneName(name: string): string {
    if (!this.scenes.some((s) => s.name === name)) return name;
    for (let n = 2; ; n++) {
      const candidate = `${name} ${n}`;
      if (!this.scenes.some((s) => s.name === candidate)) return candidate;
    }
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
    this.patterns = this.patterns.filter((p) => !names.has(p.name));

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
