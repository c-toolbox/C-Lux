// A stretch of a scene's timeline during which one pattern is lit, easing in over
// `fadeIn` seconds after `start` and out over `fadeOut` seconds before `end`.
export interface Clip {
  start: number;
  end: number;
  fadeIn: number;
  fadeOut: number;
}

// Switches a scene's patterns on and off over time. Each track is keyed by pattern name;
// a pattern with a track is lit only during its clips, one without is always lit.
export interface Timeline {
  duration: number;
  loop: boolean;
  tracks: Record<string, Clip[]>;
}

// Where a running scene's timeline is at, as the server reports it.
export interface TimelinePlayback {
  scene: string;
  timeline: Timeline;
  time: number;
  playing: boolean;
}

export const MAX_TIMELINE_DURATION = 24 * 60 * 60;
export const MAX_TIMELINE_TRACKS = 100;
export const MAX_TRACK_CLIPS = 100;

// The clips of a pattern's track, if it has one. Tracks are keyed by user-chosen names,
// so a lookup must not fall through to `Object.prototype`.
export function trackOf(timeline: Timeline, pattern: string): Clip[] | undefined {
  return Object.hasOwn(timeline.tracks, pattern) ? timeline.tracks[pattern] : undefined;
}

// Bring a running time into the timeline: wrapped around when it loops, otherwise held
// at either end.
export function wrapTime(timeline: Timeline, time: number): number {
  const { duration, loop } = timeline;
  if (loop) return ((time % duration) + duration) % duration;
  return Math.min(duration, Math.max(0, time));
}

// How lit a track is at `time`, from 0 (off) to 1 (fully on). Overlapping clips take
// the brighter of the two.
export function gateAt(clips: readonly Clip[], time: number): number {
  let gate = 0;
  for (const { start, end, fadeIn, fadeOut } of clips) {
    if (time < start || time > end) continue;
    const rise = fadeIn > 0 ? (time - start) / fadeIn : 1;
    const fall = fadeOut > 0 ? (end - time) / fadeOut : 1;
    gate = Math.max(gate, Math.min(1, rise, fall));
  }
  return gate;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateClip(raw: unknown, duration: number, path: string): Clip {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${path} must be an object`);
  }
  const { start, end, fadeIn = 0, fadeOut = 0 } = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries({ start, end, fadeIn, fadeOut })) {
    if (!isFiniteNumber(value) || value < 0) {
      throw new Error(`${path}.${key} must be a number of seconds, at least 0`);
    }
  }
  const clip = { start, end, fadeIn, fadeOut } as Clip;
  if (clip.start >= clip.end) throw new Error(`${path} must end after it starts`);
  if (clip.end > duration) throw new Error(`${path} must end within the timeline`);
  // A hair of slack, so fades scaled to fit in floating point aren't rejected.
  if (clip.fadeIn + clip.fadeOut > clip.end - clip.start + 1e-9) {
    throw new Error(`${path} fades must fit within the clip`);
  }
  return clip;
}

// Check a timeline from untrusted input and return a clean copy with its clips in
// order. With `patterns`, every track must belong to one of them.
export function validateTimeline(raw: unknown, patterns?: ReadonlySet<string>): Timeline {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('timeline must be an object');
  }
  const { duration, loop, tracks } = raw as Record<string, unknown>;
  if (!isFiniteNumber(duration) || duration <= 0 || duration > MAX_TIMELINE_DURATION) {
    throw new Error(
      `timeline.duration must be more than 0 and at most ${MAX_TIMELINE_DURATION} seconds`
    );
  }
  if (typeof loop !== 'boolean') throw new Error('timeline.loop must be true or false');
  if (typeof tracks !== 'object' || tracks === null || Array.isArray(tracks)) {
    throw new Error('timeline.tracks must be an object');
  }

  const entries = Object.entries(tracks);
  if (entries.length > MAX_TIMELINE_TRACKS) {
    throw new Error(`timeline may have at most ${MAX_TIMELINE_TRACKS} tracks`);
  }

  const clean: Array<[string, Clip[]]> = [];
  for (const [name, clips] of entries) {
    if (patterns && !patterns.has(name)) {
      throw new Error(`timeline has a track for an unknown pattern: ${name}`);
    }
    if (!Array.isArray(clips)) throw new Error(`timeline track ${name} must be a list`);
    if (clips.length > MAX_TRACK_CLIPS) {
      throw new Error(`timeline track ${name} may have at most ${MAX_TRACK_CLIPS} clips`);
    }
    const valid = clips.map((c, i) => validateClip(c, duration, `${name} clip ${i + 1}`));
    clean.push([name, valid.sort((a, b) => a.start - b.start)]);
  }

  // `fromEntries` defines own properties, so a pattern named `__proto__` stays a track.
  return { duration, loop, tracks: Object.fromEntries(clean) };
}

// The timeline with each track renamed by `rename`, or dropped where it returns null.
export function mapTracks(
  timeline: Timeline,
  rename: (pattern: string) => string | null
): Timeline {
  const tracks: Array<[string, Clip[]]> = [];
  for (const [name, clips] of Object.entries(timeline.tracks)) {
    const renamed = rename(name);
    if (renamed !== null) tracks.push([renamed, clips]);
  }
  return { ...timeline, tracks: Object.fromEntries(tracks) };
}
