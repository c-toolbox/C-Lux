import names from '../assets/names.json' with { type: 'json' };

export function randomName(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(names.adjectives)}-${pick(names.nouns)}`;
}

export function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
