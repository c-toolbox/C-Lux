import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '../config.json' with { type: 'json' };

import type { PatternProps } from './patterns/patterns';
import { PatternEngine } from './engine';
import { HttpError } from './errors';
import { startOutputs } from './output';

const engine = new PatternEngine();

// How often to send an SSE keep-alive comment so idle proxies don't close the stream.
const SSE_HEARTBEAT_MS = 15000;

//
// Route handlers — thin adapters over the engine. Handlers throw `HttpError` on failure;
// the error middleware below turns those into JSON responses.
//

function listPatterns(_req: express.Request, res: express.Response) {
  res.json(engine.listPatterns());
}

function addPattern(req: express.Request, res: express.Response) {
  const { type, props } = (req.body ?? {}) as { type?: unknown; props?: unknown };
  if (typeof type !== 'string') throw new HttpError(400, 'Missing pattern type');
  res
    .status(201)
    .json(engine.addPattern(type, (props ?? {}) as PatternProps & { name?: string }));
}

function updatePattern(req: express.Request, res: express.Response) {
  const { props } = (req.body ?? {}) as { props?: unknown };
  res.json(engine.updatePattern(String(req.params.name), props ?? {}));
}

function removePattern(req: express.Request, res: express.Response) {
  res.json(engine.removePattern(String(req.params.name)));
}

function reorderPatterns(req: express.Request, res: express.Response) {
  const { order } = (req.body ?? {}) as { order?: unknown };
  res.json(engine.reorderPatterns(order));
}

function getPause(_req: express.Request, res: express.Response) {
  res.json({ paused: engine.isPaused() });
}

function setPause(req: express.Request, res: express.Response) {
  const { paused } = (req.body ?? {}) as { paused?: unknown };
  res.json({ paused: engine.setPaused(Boolean(paused)) });
}

function getBlackout(_req: express.Request, res: express.Response) {
  res.json({ blackout: engine.isBlackout() });
}

function setBlackout(req: express.Request, res: express.Response) {
  const { blackout } = (req.body ?? {}) as { blackout?: unknown };
  res.json({ blackout: engine.setBlackout(Boolean(blackout)) });
}

function getHalfLight(_req: express.Request, res: express.Response) {
  res.json({ halfLight: engine.isHalfLight() });
}

function setHalfLight(req: express.Request, res: express.Response) {
  const { halfLight } = (req.body ?? {}) as { halfLight?: unknown };
  res.json({ halfLight: engine.setHalfLight(Boolean(halfLight)) });
}

function getFrame(_req: express.Request, res: express.Response) {
  res.json(engine.blend());
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

function getLibrary(_req: express.Request, res: express.Response) {
  res.json(engine.getLibrary());
}

async function storeCurrent(req: express.Request, res: express.Response) {
  const { name } = (req.body ?? {}) as { name?: unknown };
  res.json(await engine.storeCurrent(name));
}

function applyStored(req: express.Request, res: express.Response) {
  res.json(engine.addStored(String(req.params.name)));
}

async function renameStored(req: express.Request, res: express.Response) {
  const { newName } = (req.body ?? {}) as { newName?: unknown };
  res.json(await engine.renameStored(String(req.params.name), newName));
}

async function removeStored(req: express.Request, res: express.Response) {
  res.json(await engine.removeStored(String(req.params.name)));
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
  routes.get('/stream', streamFrames);
  routes.get('/library', getLibrary);
  routes.post('/library', storeCurrent);
  routes.post('/library/:name/apply', applyStored);
  routes.patch('/library/:name', renameStored);
  routes.delete('/library/:name', removeStored);
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
  setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    engine.tick(dt);
  }, 1000 / config.server['tick-rate']);

  // Share the blended frame over DMX-512 and/or Art-Net when enabled in config.json.
  await startOutputs(() => engine.blend());

  app.listen(config.server.port, () => {
    console.log(`C-Lux listening on http://localhost:${config.server.port}`);
  });
}

//
// main()
//
main().catch((err) => {
  console.error('Failed to start C-Lux server:', err);
  process.exit(1);
});
