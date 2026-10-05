import names from '../assets/names.json' with { type: 'json' };

export function randomName(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(names.adjectives)}-${pick(names.nouns)}`;
}

// The server caps names at this length.
const NAME_MAX_LENGTH = 60;

// A free name for a copy of `name`: "name copy", then "name copy 2", "name copy 3", …
export function copyName(name: string, taken: string[]): string {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' copy' : ` copy ${n}`;
    const candidate = name.slice(0, NAME_MAX_LENGTH - suffix.length).trimEnd() + suffix;
    if (!taken.includes(candidate)) return candidate;
  }
}

// Turn a scene name into a safe file name for the exported JSON.
function fileNameFor(name: string): string {
  const base = name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  return `${base === '' ? 'scene' : base}.json`;
}

// Save a value as a JSON file through the browser's download flow.
export function downloadJson(name: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameFor(name);
  link.click();
  URL.revokeObjectURL(url);
}

// Read a user-picked file as JSON. The parsed value is untrusted; the server validates
// it before storing anything.
export async function readJsonFile(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`${file.name} is not valid JSON`);
  }
}
