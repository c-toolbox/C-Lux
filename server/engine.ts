import type { DebugStatus, DebugUpdate } from '../shared/debug';
import { type Color, Pattern } from '../shared/patterns/pattern';
import {
  patternByType,
  patternFromParameters,
  type PatternParameters,
  type PatternProps,
  type Scene
} from '../shared/patterns/patterns';
import {
  SOLID_COLOR_NAME,
  type SolidColorStatus,
  type SolidColorUpdate,
  StaticPattern
} from '../shared/patterns/static';

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

// Ceiling on how many stacks may dissolve at once. Each one costs a full blend per tick,
// so a burst of scene changes drops the oldest instead of piling up.
const MAX_FADING_STACKS = 4;

type FrameListener = (frame: number[]) => void;

// What the lights were showing when a scene change came in: the pattern stack at that
// moment, plus whether the solid color layer was part of it. It keeps ticking while
// `weight` — how far the stack that replaced it has faded in — runs from 0 to 1.
interface FadingStack {
  patterns: Array<Pattern>;
  solidEnabled: boolean;
  weight: number;
}

// Owns all mutable server state (patterns, scenes, blackout) and the logic that
// ticks animations, blends layers, and broadcasts frames. The active pattern list is
// deliberately not persisted: it only outlives a restart once saved as a scene.
export class Engine {
  private patterns: Array<Pattern> = [];
  private scenes: Array<Scene> = [];

  // Which scenes are switched on, by name. Tracked explicitly rather than inferred from
  // the running patterns, so two scenes that share patterns don't toggle each other.
  private applied = new Set<string>();

  // Stacks an earlier scene change moved away from, oldest first, each dissolving into
  // the one after it (the current stack for the last of them).
  private fading: Array<FadingStack> = [];

  // The hardcoded bottom layer. It is kept out of `patterns` so it never shows up in
  // the editor or in a saved scene, and is composited under them by `blend()`.
  private solidColor = new StaticPattern({
    name: SOLID_COLOR_NAME,
    enabled: false,
    ...SOLID_COLOR_DEFAULT
  });

  // Master blackout. `brightnessFactor` scales the output and eases between 1 (full) and
  // 0 (black) so the lights fade rather than snap.
  private blackout = false;
  private brightnessFactor = 1;

  // Half-light mode. When on, the top of the ring is blacked out. `halfLightFactor`
  // eases between 0 (off) and 1 (fully applied) so the transition fades instead of
  // snapping. `halfLightMask[i]` is how dark light i gets when fully applied (1 = fully
  // dark at the top, 0 = untouched at the bottom), interpolated across the seam. The mask
  // is rebuilt whenever the settings that shape it are edited, so `halfLightMaskShape`
  // records the ones it was built from.
  private halfLight = false;
  private halfLightFactor = 0;
  private halfLightMask: number[] = buildHalfLightMask();
  private halfLightMaskShape = halfLightMaskShape();

  // Overrides the debug page sets while checking the wiring. They short-circuit `blend()`
  // and so affect the live preview and the Art-Net output alike. Nothing here is
  // persisted; a restart clears them.
  private debug: DebugStatus = {
    suspended: false,
    light: null,
    color: { r: 255, g: 255, b: 255 }
  };

  // Serialized disk writer for the scenes; scene edits are rare, so they're written
  // immediately instead of debounced.
  private savingScenes: Promise<void> = Promise.resolve();

  private frameListeners = new Set<FrameListener>();

  // Reused scratch buffers for blend() so a fresh array isn't allocated every tick; every
  // caller consumes the result synchronously (serializes or copies it) before blend() can
  // be called again, so sharing these buffers across calls is safe.
  private readonly blendAccum: number[] = new Array<number>(config.nLights * 3).fill(0);
  private readonly blendNext: number[] = new Array<number>(config.nLights * 3).fill(0);
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
    // Any scene that needed this pattern is no longer fully applied.
    for (const scene of this.scenes) {
      if (scene.patterns.some((p) => p.name === name)) this.applied.delete(scene.name);
    }
    return { name };
  }

  // Drop every pattern, leaving only the hardcoded solid color layer under them.
  clearPatterns(): PatternParameters[] {
    this.beginTransition();
    this.patterns = [];
    this.applied.clear();
    return this.listPatterns();
  }

  updatePattern(name: string, props: Record<string, unknown>): PatternParameters {
    const instance = this.patterns.find((p) => p.name === name);
    if (!instance) throw new HttpError(404, `No pattern named: ${name}`);

    const { type } = instance.parameters() as PatternParameters;
    instance.update(validateUpdatedPatternProps(type, props));
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

  reorderPatterns(order: string[]): string[] {
    if (order.length !== this.patterns.length) {
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
    return this.patterns.map((p) => p.name);
  }

  //
  // Solid color
  //

  solidColorStatus(): SolidColorStatus {
    const { color } = this.solidColor.parameters();
    return { enabled: this.solidColor.enabled, target: color };
  }

  // A new color eases in from whatever is currently lit over `solidColorTransition`
  // seconds; `enabled` switches the whole layer on or off.
  setSolidColor({ color, enabled }: SolidColorUpdate): SolidColorStatus {
    if (color) this.solidColor.fadeTo(color, config.server.solidColorTransition);
    // Switching the layer on or off counts as a scene change, so it dissolves like one
    // rather than popping in or out under the patterns.
    if (enabled !== undefined && enabled !== this.solidColor.enabled) {
      this.beginTransition();
      this.solidColor.enabled = enabled;
    }
    return this.solidColorStatus();
  }

  //
  // Blackout
  //

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
  // Debug overrides
  //

  debugStatus(): DebugStatus {
    return { ...this.debug, color: { ...this.debug.color } };
  }

  setDebug({ suspended, light, color }: DebugUpdate): DebugStatus {
    if (suspended !== undefined) this.debug.suspended = suspended;
    if (light !== undefined) this.debug.light = light;
    if (color) this.debug.color = { ...color };
    return this.debugStatus();
  }

  //
  // Scenes
  //

  listScenes(): Scene[] {
    return this.scenes;
  }

  // The names of the scenes currently switched on, in scene-list order.
  appliedScenes(): string[] {
    return this.scenes.filter((s) => this.applied.has(s.name)).map((s) => s.name);
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

    // The saved scene is exactly what is running, so it counts as applied.
    this.applied.add(name);

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

  applyScene(name: string): string[] {
    const scene = this.scenes.find((s) => s.name === name);
    if (!scene) throw new HttpError(404, `No scene named: ${name}`);

    this.beginTransition();

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

    this.applied.add(name);
    this.sortBySceneOrder();
    return this.appliedScenes();
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
  // Patterns another applied scene also holds stay put, so switching one scene off can't
  // tear a hole in the ones still on.
  unapplyScene(name: string): string[] {
    const scene = this.scenes.find((s) => s.name === name);
    if (!scene) throw new HttpError(404, `No scene named: ${name}`);

    this.beginTransition();

    this.applied.delete(name);

    const keep = new Set<string>();
    for (const other of this.scenes) {
      if (!this.applied.has(other.name)) continue;
      for (const params of other.patterns) keep.add(params.name);
    }

    const drop = new Set(scene.patterns.map((p) => p.name).filter((n) => !keep.has(n)));
    this.patterns = this.patterns.filter((p) => !drop.has(p.name));

    return this.appliedScenes();
  }

  // Swap the active list for a scene. Every pattern is built before anything is
  // discarded, so a missing scene or an unusable entry leaves the current list untouched
  // instead of half-cleared.
  replaceWithScene(name: string): string[] {
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

    this.beginTransition();
    this.patterns = replacement;
    this.applied = new Set([name]);
    return this.appliedScenes();
  }

  async reorderScenes(order: string[]): Promise<Scene[]> {
    if (order.length !== this.scenes.length) {
      throw new HttpError(400, 'order must list every existing scene name once');
    }

    const byName = new Map(this.scenes.map((s) => [s.name, s]));
    const reordered: Scene[] = [];
    for (const name of order) {
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
    if (this.applied.delete(name)) this.applied.add(trimmed);

    await this.persistScenes('rename');
    return this.scenes;
  }

  async deleteScene(name: string): Promise<{ name: string }> {
    const index = this.scenes.findIndex((s) => s.name === name);
    if (index === -1) throw new HttpError(404, `No scene named: ${name}`);

    this.scenes.splice(index, 1);
    this.applied.delete(name);

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

  // Remember what the lights are showing so that the change the caller is about to make
  // dissolves out of it instead of cutting. A non-positive `sceneTransition` switches the
  // dissolve off and every change lands at once.
  private beginTransition(): void {
    if (config.server.sceneTransition <= 0) return;

    this.fading.push({
      patterns: this.patterns.slice(),
      solidEnabled: this.solidColor.enabled,
      weight: 0
    });

    if (this.fading.length > MAX_FADING_STACKS) this.fading.shift();
  }

  // The stack `index` steps back in the dissolve chain, which is the current one once
  // past every stack still fading out.
  private stackAt(index: number): { patterns: Array<Pattern>; solidEnabled: boolean } {
    return (
      this.fading[index] ?? {
        patterns: this.patterns,
        solidEnabled: this.solidColor.enabled
      }
    );
  }

  // Blend the individual patterns into a single flat RGB array using source-over alpha
  // compositing (first pattern on the bottom, last on top), scaled by the master
  // brightness. Returns a buffer reused across calls; consume it before calling again.
  blend(): number[] {
    const { nLights } = config;

    // The debug overrides replace the frame outright rather than layering over it: with a
    // light selected only that one is lit, and while suspended nothing is. Both bypass
    // the blackout and half-light masks so what the debug page asks for is what ships.
    if (this.debug.light !== null || this.debug.suspended) return this.debugFrame();

    const accum = this.blendAccum;

    const oldest = this.stackAt(0);
    this.compositeStack(oldest.patterns, oldest.solidEnabled, accum);

    // Cross-dissolve each newer stack over the one before it, ending at the current one.
    // Mixing whole stacks rather than fading the individual patterns keeps the lights at
    // full strength throughout instead of dipping to the background mid-transition.
    for (const [i, fade] of this.fading.entries()) {
      const next = this.stackAt(i + 1);
      this.compositeStack(next.patterns, next.solidEnabled, this.blendNext);
      for (let j = 0; j < accum.length; j++) {
        accum[j] += (this.blendNext[j] - accum[j]) * fade.weight;
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

  // The frame the debug overrides ask for: everything dark, except the selected light if
  // there is one.
  private debugFrame(): number[] {
    const out = this.blendOut;
    out.fill(0);

    const { light, color } = this.debug;
    if (light !== null) {
      const dst = light * 3;
      out[dst] = color.r;
      out[dst + 1] = color.g;
      out[dst + 2] = color.b;
    }
    return out;
  }

  // Composite one stack of patterns into `accum`, the solid color layer underneath them.
  private compositeStack(
    patterns: Array<Pattern>,
    solidEnabled: boolean,
    accum: number[]
  ): void {
    accum.fill(0);

    if (solidEnabled) this.composite(this.solidColor, accum);
    for (const p of patterns) {
      if (!p.enabled) continue;
      this.composite(p, accum);
    }
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

  // Advance every pattern that is on the lights, whether it belongs to the current stack
  // or to one still dissolving. Stacks share instances — applying a scene leaves the
  // patterns already running in place — so each is only ticked once.
  private tickPatterns(dt: number): void {
    if (this.fading.length === 0) {
      for (const p of this.patterns) if (p.enabled) p.tick(dt);
      return;
    }

    const ticked = new Set<Pattern>();
    for (let i = 0; i <= this.fading.length; i++) {
      for (const p of this.stackAt(i).patterns) {
        if (!p.enabled || ticked.has(p)) continue;
        ticked.add(p);
        p.tick(dt);
      }
    }
  }

  // Advance every pattern and ease the brightness factors toward their targets.
  tick(dt: number): void {
    this.tickPatterns(dt);
    this.solidColor.tick(dt);

    // Likewise for the scene dissolves. Each stack is dropped once the one that replaced
    // it has fully faded in; later stacks started later, so they can never finish first.
    for (const fade of this.fading) {
      fade.weight = approach(fade.weight, 1, dt, config.server.sceneTransition);
    }
    while (this.fading.length > 0 && this.fading[0].weight >= 1) this.fading.shift();

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

    const shape = halfLightMaskShape();
    if (shape !== this.halfLightMaskShape) {
      this.halfLightMaskShape = shape;
      this.halfLightMask = buildHalfLightMask();
    }

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
// +1 at the top, -1 at the bottom. `halfLightCoverage` is the fraction of the ring that
// goes dark, measured down from the top, so the boundary sits at cos(π·coverage) - the
// horizontal midline at 0.5. Darkness ramps from 1 above it to 0 below, feathered over a
// band around the boundary so the dark and lit parts interpolate.
function buildHalfLightMask(): number[] {
  const { nLights } = config;
  // A feather of 0 means a hard line; the epsilon keeps the ramp from dividing by zero.
  const feather = Math.max(1e-6, config.server.halfLightFeather);
  const edge = Math.cos(Math.PI * config.server.halfLightCoverage);
  const mask = new Array<number>(nLights);
  for (let i = 0; i < nLights; i++) {
    const vertical = Math.cos((2 * Math.PI * i) / nLights);
    mask[i] = Math.min(1, Math.max(0, 0.5 + (vertical - edge) / feather));
  }
  return mask;
}

// The settings `buildHalfLightMask` reads, as a value that can be compared between ticks
// to notice a save from the config page.
function halfLightMaskShape(): string {
  return `${config.nLights}:${config.server.halfLightCoverage}:${config.server.halfLightFeather}`;
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
