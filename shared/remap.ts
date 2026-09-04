// Per-light address fix-ups for fixtures that were wired or patched out of order:
// `{ "5": 3 }` sends the color computed for light 5 to light 3 instead. Lights left out
// of the map keep their 1:1 mapping, and entries are one-way - an entry outranks the 1:1
// mapping of the light it lands on, and a light whose color was sent elsewhere goes dark
// unless another entry fills its place.

// A destination of -1 throws the color away instead of sending it anywhere, which is how
// a light is switched off for good.
export const REMAP_DISABLED = -1;

// Resolve a remap into, for each light, the light whose color it ends up showing - or
// null for the ones that end up dark.
export function remapSources(
  nLights: number,
  remap: Record<string, number>
): Array<number | null> {
  const moved = new Set(Object.keys(remap).map(Number));
  const sources = new Array<number | null>(nLights).fill(null);
  for (const [from, to] of Object.entries(remap)) {
    if (to !== REMAP_DISABLED) sources[to] = Number(from);
  }
  for (let i = 0; i < nLights; i++) {
    if (sources[i] === null && !moved.has(i)) sources[i] = i;
  }
  return sources;
}

// Rewrite a flat RGB frame through a source table into `out`, which must be the same
// length. Returns `out` so it can be used inline.
export function applyRemap(
  frame: number[],
  sources: Array<number | null>,
  out: number[]
): number[] {
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const dst = i * 3;
    if (source === null) {
      out[dst] = 0;
      out[dst + 1] = 0;
      out[dst + 2] = 0;
      continue;
    }
    const src = source * 3;
    out[dst] = frame[src];
    out[dst + 1] = frame[src + 1];
    out[dst + 2] = frame[src + 2];
  }
  return out;
}
