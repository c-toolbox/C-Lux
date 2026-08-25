import type express from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { config } from './config';
import { HttpError } from './errors';
import { parseBody } from './validation';

// Sessions live in memory only: a restart signs every editor out, which is acceptable
// for a single-box installation and keeps the password off the disk in any other form.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Crude brute-force brake. The password is shared by everyone, so one global counter is
// enough; there is no per-user state to attribute failures to.
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MS = 5 * 60 * 1000;

const loginBody = z.object({ password: z.string('must be a string') });

// The environment wins so a deployment can keep the secret out of config.json entirely.
const password = (process.env.CLUX_EDIT_PASSWORD ?? config.server.editPassword).trim();

// Leaving the password empty deliberately opens everything up: the editor endpoints stop
// asking for a token and the edit page skips its unlock screen. Only sensible on a
// network where everyone who can reach the box is allowed to drive the lights.
const authRequired = password !== '';
if (!authRequired) {
  console.warn(
    'No editor password configured: the editor and the endpoints it drives are open to ' +
      'anyone who can reach this server. Set server.editPassword in config.json or the ' +
      'CLUX_EDIT_PASSWORD environment variable to protect them.'
  );
}

// token -> expiry timestamp.
const sessions = new Map<string, number>();
let failedAttempts = 0;
let lockedUntil = 0;

// Comparing digests rather than the raw strings keeps the comparison a fixed length, so
// `timingSafeEqual` never throws and the password's length isn't leaked by the failure.
function matches(candidate: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(hash(candidate), hash(password));
}

function bearerToken(req: express.Request): string | null {
  const [scheme, value] = (req.get('authorization') ?? '').split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}

function isAuthenticated(req: express.Request): boolean {
  if (!authRequired) return true;

  const token = bearerToken(req);
  if (!token) return false;

  const expiresAt = sessions.get(token);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// Guards the endpoints the edit page drives. Read-only and home-page endpoints stay open
// so the landing page keeps working without the password.
export function requireAuth(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction
) {
  if (!isAuthenticated(req)) throw new HttpError(401, 'Editor password required');
  next();
}

// Lets the edit page find out whether a token it kept from an earlier visit still works
// before it decides to render the editor or ask for the password again. `required` tells
// it whether there is a password at all, so it can drop the lock button when there isn't.
export function getAuth(req: express.Request, res: express.Response) {
  res.json({ authenticated: isAuthenticated(req), required: authRequired });
}

export function login(req: express.Request, res: express.Response) {
  const { password: candidate } = parseBody(loginBody, req.body);
  const now = Date.now();

  if (!authRequired) throw new HttpError(409, 'No editor password is configured');

  if (now < lockedUntil) {
    throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
  }

  if (!matches(candidate)) {
    failedAttempts += 1;
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = now + LOCKOUT_MS;
      failedAttempts = 0;
    }
    throw new HttpError(401, 'Incorrect password');
  }

  failedAttempts = 0;
  for (const [token, expiresAt] of sessions) {
    if (expiresAt <= now) sessions.delete(token);
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + SESSION_TTL_MS;
  sessions.set(token, expiresAt);
  res.json({ token, expiresAt });
}

export function logout(req: express.Request, res: express.Response) {
  const token = bearerToken(req);
  if (token) sessions.delete(token);
  res.status(204).end();
}
