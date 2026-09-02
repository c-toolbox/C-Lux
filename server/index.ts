import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { publishAudioFrame } from './audio';
import { getAuth, login, logout, requireAuth } from './auth';
import { config } from './config';
import { Engine } from './engine';
import { HttpError } from './errors';
import { startOutputs } from './output';
import { parseBody } from './validation';
import { publishVideoStrip } from './video';

const engine = new Engine();

// How often to send an SSE keep-alive comment so idle proxies don't close the stream.
const SSE_HEARTBEAT_MS = 15000;

// A strip is 2 header bytes plus 3 per color, so this covers the widest strip the
// shared contract allows with room to spare, and rejects anything larger outright.
const VIDEO_BODY_LIMIT = '8kb';

// Request-body shapes. `parseBody` turns a mismatch into a 400 before a handler runs,
// so the casts scattered over the handlers below can't hide a malformed body.
const addPatternBody = z.object({
  type: z.string('Missing pattern type'),
  props: z.record(z.string(), z.unknown()).optional()
});
const updatePatternBody = z.object({
  props: z.record(z.string(), z.unknown()).optional()
});
const orderBody = z.object({ order: z.array(z.string()) });
const enabledBody = z.object({ enabled: z.boolean('must be true or false') });
const blackoutBody = z.object({
  blackout: z.boolean('must be true or false')
});
const halfLightBody = z.object({
  halfLight: z.boolean('must be true or false')
});
const sceneNameBody = z.object({ name: z.string('must be a string') });
const renameSceneBody = z.object({
  newName: z.string('must be a string')
});
const channel = z.int('must be a whole number').min(0).max(255);
const solidColorBody = z.object({
  color: z.object({ r: channel, g: channel, b: channel }).optional(),
  enabled: z.boolean('must be true or false').optional()
});
const debugBody = z.object({
  suspended: z.boolean('must be true or false').optional(),
  light: z
    .int('must be a whole number')
    .min(0)
    .max(config.nLights - 1)
    .nullable()
    .optional(),
  color: z.object({ r: channel, g: channel, b: channel }).optional()
});

//
// Route handlers — thin adapters over the engine. Handlers throw `HttpError` on failure;
// the error middleware below turns those into JSON responses.
//

function listPatterns(_req: express.Request, res: express.Response) {
  res.json(engine.listPatterns());
}

function addPattern(req: express.Request, res: express.Response) {
  const { type, props } = parseBody(addPatternBody, req.body);
  res.status(201).json(engine.addPattern(type, props ?? {}));
}

function updatePattern(req: express.Request, res: express.Response) {
  const { props } = parseBody(updatePatternBody, req.body);
  res.json(engine.updatePattern(String(req.params.name), props ?? {}));
}

function removePattern(req: express.Request, res: express.Response) {
  res.json(engine.removePattern(String(req.params.name)));
}

function clearPatterns(_req: express.Request, res: express.Response) {
  res.json(engine.clearPatterns());
}

function setPatternEnabled(req: express.Request, res: express.Response) {
  const { enabled } = parseBody(enabledBody, req.body);
  res.json(engine.setPatternEnabled(String(req.params.name), enabled));
}

function reorderPatterns(req: express.Request, res: express.Response) {
  const { order } = parseBody(orderBody, req.body);
  res.json(engine.reorderPatterns(order));
}

function getBlackout(_req: express.Request, res: express.Response) {
  res.json({ blackout: engine.isBlackout() });
}

function setBlackout(req: express.Request, res: express.Response) {
  const { blackout } = parseBody(blackoutBody, req.body);
  res.json({ blackout: engine.setBlackout(blackout) });
}

function getHalfLight(_req: express.Request, res: express.Response) {
  res.json({ halfLight: engine.isHalfLight() });
}

function setHalfLight(req: express.Request, res: express.Response) {
  const { halfLight } = parseBody(halfLightBody, req.body);
  res.json({ halfLight: engine.setHalfLight(halfLight) });
}

// The color the hardcoded solid-color layer is showing, plus its fade target.
function getSolidColor(_req: express.Request, res: express.Response) {
  res.json(engine.solidColorStatus());
}

// Fade the solid-color layer to a new color and/or switch the layer on or off.
function setSolidColor(req: express.Request, res: express.Response) {
  res.json(engine.setSolidColor(parseBody(solidColorBody, req.body)));
}

// The debug page's temporary overrides on the output: whether the scene is suspended,
// and which single light is being driven directly.
function getDebug(_req: express.Request, res: express.Response) {
  res.json(engine.debugStatus());
}

function setDebug(req: express.Request, res: express.Response) {
  res.json(engine.setDebug(parseBody(debugBody, req.body)));
}

// Ingest one analysis frame from a browser capturing the sound card. Answers 204 so a
// client posting tens of times a second doesn't have to read a body it ignores.
function postAudio(req: express.Request, res: express.Response) {
  publishAudioFrame(req.body);
  res.status(204).end();
}

// Ingest one strip from a browser sampling a video feed. Answers 204 for the same
// reason the audio endpoint does.
function postVideo(req: express.Request, res: express.Response) {
  publishVideoStrip(req.body);
  res.status(204).end();
}

// Stream the blended frame to the client on every tick via Server-Sent Events.
function streamFrames(req: express.Request, res: express.Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Ask reverse proxies (e.g. nginx) not to buffer the stream.
    'X-Accel-Buffering': 'no'
  });
  res.write(`data: ${JSON.stringify(engine.blend())}\n\n`);

  const unsubscribe = engine.onFrame((frame) => {
    res.write(`data: ${JSON.stringify(frame)}\n\n`);
  });

  // Keep idle proxies/load balancers from timing out the connection between frames.
  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), SSE_HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function listScenes(_req: express.Request, res: express.Response) {
  res.json(engine.listScenes());
}

// The names of the scenes currently switched on.
function appliedScenes(_req: express.Request, res: express.Response) {
  res.json(engine.appliedScenes());
}

async function saveScene(req: express.Request, res: express.Response) {
  const { name } = parseBody(sceneNameBody, req.body);
  res.json(await engine.saveScene(name));
}

// Add a scene from a JSON file the user picked in the browser. The whole body is the
// exported scene; the engine validates it before anything is kept.
async function importScene(req: express.Request, res: express.Response) {
  res.status(201).json(await engine.importScene(req.body));
}

async function reorderScenes(req: express.Request, res: express.Response) {
  const { order } = parseBody(orderBody, req.body);
  res.json(await engine.reorderScenes(order));
}

function applyScene(req: express.Request, res: express.Response) {
  res.json(engine.applyScene(String(req.params.name)));
}

function unapplyScene(req: express.Request, res: express.Response) {
  res.json(engine.unapplyScene(String(req.params.name)));
}

function replaceWithScene(req: express.Request, res: express.Response) {
  res.json(engine.replaceWithScene(String(req.params.name)));
}

async function renameScene(req: express.Request, res: express.Response) {
  const { newName } = parseBody(renameSceneBody, req.body);
  res.json(await engine.renameScene(String(req.params.name), newName));
}

async function deleteScene(req: express.Request, res: express.Response) {
  res.json(await engine.deleteScene(String(req.params.name)));
}

async function main() {
  await engine.load();

  const app = express();

  app.use(cors());
  app.use(express.json());

  // All endpoints live under /api so a single proxy/CORS rule covers them.
  // `requireAuth` marks the ones the edit page drives; everything the landing page needs
  // stays open so the house controls work without the password.
  const routes = express.Router();
  routes.get('/auth', getAuth);
  routes.post('/auth/login', login);
  routes.post('/auth/logout', logout);
  routes.get('/patterns', listPatterns);
  routes.post('/patterns', requireAuth, addPattern);
  routes.post('/patterns/reorder', requireAuth, reorderPatterns);
  routes.post('/patterns/clear', clearPatterns);
  routes.patch('/patterns/:name', requireAuth, updatePattern);
  routes.put('/patterns/:name/enabled', requireAuth, setPatternEnabled);
  routes.delete('/patterns/:name', requireAuth, removePattern);
  routes.get('/blackout', getBlackout);
  routes.put('/blackout', setBlackout);
  routes.get('/half-light', getHalfLight);
  routes.put('/half-light', setHalfLight);
  routes.get('/solid-color', getSolidColor);
  routes.put('/solid-color', setSolidColor);
  // The debug page overrides what the lights show, so it sits behind the edit password.
  routes.get('/debug', requireAuth, getDebug);
  routes.put('/debug', requireAuth, setDebug);
  // Open like the other house controls: the landing page runs the capture widgets too,
  // and a frame can only feed a pattern someone already enabled.
  routes.post('/audio', postAudio);
  routes.post(
    '/video',
    express.raw({ type: 'application/octet-stream', limit: VIDEO_BODY_LIMIT }),
    postVideo
  );
  routes.get('/stream', streamFrames);
  routes.get('/scenes', listScenes);
  routes.get('/scenes/applied', appliedScenes);
  routes.post('/scenes', requireAuth, saveScene);
  routes.post('/scenes/import', requireAuth, importScene);
  routes.post('/scenes/reorder', requireAuth, reorderScenes);
  routes.post('/scenes/:name/apply', applyScene);
  routes.post('/scenes/:name/unapply', unapplyScene);
  routes.post('/scenes/:name/replace', replaceWithScene);
  routes.patch('/scenes/:name', requireAuth, renameScene);
  routes.delete('/scenes/:name', requireAuth, deleteScene);
  app.use('/api', routes);

  // Unknown API routes get a JSON 404 instead of falling through to the SPA.
  app.use('/api', (_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // In production, serve the built SPA from the same origin (skipped in dev, where Vite
  // serves the frontend and proxies /api).
  const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/*splat', (_req: express.Request, res: express.Response) => {
      res.sendFile(resolve(distDir, 'index.html'));
    });
  }

  // Centralized error handling: map `HttpError` to its status, everything else to 500.
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error('Unhandled request error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  );

  // Advance every pattern at a fixed rate so animations progress over time.
  let last = Date.now();
  const tickTimer = setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    engine.tick(dt);
  }, 1000 / config.server.tickRate);

  // Share the blended frame over Art-Net when enabled in config.json.
  const outputs = startOutputs(() => engine.blend());

  const httpServer = app.listen(config.server.port, () => {
    console.log(`C-Lux listening on http://localhost:${config.server.port}`);
  });

  // Stop the timers and outputs on shutdown so the process can exit cleanly.
  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`${signal} received, shutting down`);
    clearInterval(tickTimer);
    for (const output of outputs) output.stop();
    httpServer.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

//
// main()
//
main().catch((err) => {
  console.error('Failed to start C-Lux server:', err);
  process.exit(1);
});
