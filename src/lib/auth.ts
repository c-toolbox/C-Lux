// The editor's session token. Kept in `sessionStorage` so it survives a reload but not
// the tab closing, and so other tabs of the same browser aren't unlocked implicitly.
const TOKEN_KEY = 'clux.editorToken';

const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    // Private modes can refuse storage entirely; fall back to memory only.
    return null;
  }
}

let token = read();

export function editorToken(): string | null {
  return token;
}

export function setEditorToken(value: string | null): void {
  token = value;
  try {
    if (value === null) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, value);
  } catch {
    // The in-memory token still works for this page view.
  }
}

// Authorizes a request against an editor-only endpoint.
export function authHeaders(): Record<string, string> {
  return token === null ? {} : { Authorization: `Bearer ${token}` };
}

// Drop the token and let the editor know it has to ask for the password again, either
// because the user locked it or because the server rejected it.
export function signOut(): void {
  setEditorToken(null);
  for (const listener of listeners) listener();
}

export function onSignedOut(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
