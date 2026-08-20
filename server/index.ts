import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { audioFrame } from '../shared/audio';

import { publishAudioFrame } from './audio';
import { config } from './config';
import { PatternEngine } from './engine';
import { HttpError } from './errors';
import { startOutputs } from './output';
import { parseBody } from './validation';

const engine = new PatternEngine();

// How often to send an SSE keep-alive comment so idle proxies don't close the stream.
const SSE_HEARTBEAT_MS = 15000;

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
const pausedBody = z.object({ paused: z.boolean('must be true or false') });
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

function reorderPatterns(req: express.Request, res: express.Response) {
  const { order } = parseBody(orderBody, req.body);
  res.json(engine.reorderPatterns(order));
}

function getPause(_req: express.Request, res: express.Response) {
  res.json({ paused: engine.isPaused() });
}

function setPause(req: express.Request, res: express.Response) {
  const { paused } = parseBody(pausedBody, req.body);
  res.json({ paused: engine.setPaused(paused) });
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

function getFrame(_req: express.Request, res: express.Response) {
  res.json(engine.blend());
}

// The latest analysis a capture client streamed, for patterns and diagnostics.
function getAudio(_req: express.Request, res: express.Response) {
  res.json(audioFrame());
}

// Ingest one analysis frame from a browser capturing the sound card. Answers 204 so a
// client posting tens of times a second doesn't have to read a body it ignores.
function postAudio(req: express.Request, res: express.Response) {
  publishAudioFrame(req.body);
  res.status(204).end();
}

// Durability of the pattern list on disk. Pattern mutations answer before the debounced
// write runs, so this is how a client or monitor learns a save is failing.
function getHealth(_req: express.Request, res: express.Response) {
  const persistence = engine.persistenceStatus();
  res.status(persistence.ok ? 200 : 503).json({ ok: persistence.ok, persistence });
}

// Force the pending write and answer 500 if it fails, so a caller can confirm its
// changes actually reached the disk.
async function persistPatterns(_req: express.Request, res: express.Response) {
  res.json(await engine.flushPersist());
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

async function saveScene(req: express.Request, res: express.Response) {
  const { name } = parseBody(sceneNameBody, req.body);
  res.json(await engine.saveScene(name));
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
  const routes = express.Router();
  routes.get('/patterns', listPatterns);
  routes.post('/patterns', addPattern);
  routes.post('/patterns/reorder', reorderPatterns);
  routes.patch('/patterns/:name', updatePattern);
  routes.delete('/patterns/:name', removePattern);
  routes.get('/pause', getPause);
  routes.put('/pause', setPause);
  routes.get('/blackout', getBlackout);
  routes.put('/blackout', setBlackout);
  routes.get('/half-light', getHalfLight);
  routes.put('/half-light', setHalfLight);
  routes.get('/frame', getFrame);
  routes.get('/audio', getAudio);
  routes.post('/audio', postAudio);
  routes.get('/stream', streamFrames);
  routes.get('/health', getHealth);
  routes.post('/persist', persistPatterns);
  routes.get('/scenes', listScenes);
  routes.post('/scenes', saveScene);
  routes.post('/scenes/reorder', reorderScenes);
  routes.post('/scenes/:name/apply', applyScene);
  routes.post('/scenes/:name/unapply', unapplyScene);
  routes.post('/scenes/:name/replace', replaceWithScene);
  routes.patch('/scenes/:name', renameScene);
  routes.delete('/scenes/:name', deleteScene);
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

  // Share the blended frame over DMX-512 and/or Art-Net when enabled in config.json.
  const outputs = await startOutputs(() => engine.blend());

  const httpServer = app.listen(config.server.port, () => {
    console.log(`C-Lux listening on http://localhost:${config.server.port}`);
  });

  // On shutdown, flush the debounced pattern save so an edit made just before Ctrl+C
  // isn't lost, and stop the timers/outputs so the process can exit cleanly.
  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`${signal} received, shutting down`);
    clearInterval(tickTimer);
    for (const output of outputs) output.stop();
    httpServer.close();
    engine
      .flushPersist()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error('Failed to save patterns during shutdown:', err);
        process.exit(1);
      });
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
