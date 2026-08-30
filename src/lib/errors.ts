// Turn anything thrown by a request or a browser API into a message a user can read.
export function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
