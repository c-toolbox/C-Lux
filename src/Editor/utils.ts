import names from '../assets/names.json' with { type: 'json' };

export function randomName(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(names.adjectives)}-${pick(names.nouns)}`;
}

export function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
