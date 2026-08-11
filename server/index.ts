import cors from 'cors';
import express from 'express';

import config from '../config.json' with { type: 'json' };

import { Pattern } from './patterns/pattern';
import {
  patternByType,
  type PatternParameters,
  type StoredPatternSet
} from './patterns/patterns';
import { startOutputs } from './output';
import {
  loadLibrary,
  loadPatterns,
  patternFromParameters,
  saveLibrary,
  savePatterns
} from './storage';

let individualPatterns: Array<Pattern> = [];
let library: Array<StoredPatternSet> = [];

// Global pause for the whole server. `pauseFactor` scales the tick dt and is
// interpolated between 1 (running) and 0 (paused) so animations ease in and out.
let serverPaused = false;
let pauseFactor = 1;

// Master blackout. `brightnessFactor` scales the output and is interpolated
// between 1 (full) and 0 (black) so the lights fade out and back in.
let blackout = false;
let brightnessFactor = 1;

// Persist the current patterns to disk, logging any failure without crashing.
function persist() {
  savePatterns(individualPatterns).catch((err) => {
    console.error('Failed to save patterns:', err);
  });
}

// Return the list of current patterns
function currentPatterns(_req: express.Request, res: express.Response) {
  res.json(individualPatterns.map((p) => p.parameters()));
}

// Add a new pattern
function addNewPattern(req: express.Request, res: express.Response) {
  const { type, props } = req.body ?? {};

  const { name } = props ?? {};

  if (!name) {
    res.status(400).json({ error: `Missing name for new pattern` });
    return;
  }

  if (individualPatterns.find((p) => p.name === name)) {
    res.status(400).json({ error: `A pattern named ${name} already exists` });
    return;
  }

  // Look up the registered pattern class by its type tag
  const cls = patternByType(type);

  if (!cls) {
    res.status(400).json({ error: `Unknown pattern type: ${type}` });
    return;
  }

  const instance = new cls(props);
  individualPatterns.push(instance);
  persist();
  res.status(201).json({ name: instance.name });
}

// Remove an existing pattern
function removePattern(req: express.Request, res: express.Response) {
  const { name } = req.body ?? {};

  const index = individualPatterns.findIndex((p) => p.name === name);
  if (index === -1) {
    res.status(404).json({ error: `No pattern named: ${name}` });
    return;
  }

  individualPatterns.splice(index, 1);
  persist();
  res.json({ name });
}

// Update an existing pattern
function updatePattern(req: express.Request, res: express.Response) {
  const { name, props } = req.body ?? {};

  const instance = individualPatterns.find((p) => p.name === name);
  if (!instance) {
    res.status(404).json({ error: `No pattern named: ${name}` });
    return;
  }

  instance.set(props);
  persist();
  res.json(instance.parameters());
}

// Report whether the whole server is paused
function serverPausedState(_req: express.Request, res: express.Response) {
  res.json({ paused: serverPaused });
}

// Pause or resume every pattern at once via the global tick scale
function setServerPaused(req: express.Request, res: express.Response) {
  const { paused } = req.body ?? {};
  serverPaused = Boolean(paused);
  res.json({ paused: serverPaused });
}

// Report whether the master blackout is engaged
function blackoutState(_req: express.Request, res: express.Response) {
  res.json({ blackout });
}

// Fade the whole output to black or restore it via the master brightness scale
function setBlackout(req: express.Request, res: express.Response) {
  const { blackout: next } = req.body ?? {};
  blackout = Boolean(next);
  res.json({ blackout });
}

function reorderPatterns(req: express.Request, res: express.Response) {
  const { order } = req.body ?? {};

  if (!Array.isArray(order) || order.length !== individualPatterns.length) {
    res.status(400).json({ error: `order must list every existing pattern name once` });
    return;
  }

  const byName = new Map(individualPatterns.map((p) => [p.name, p]));
  const reordered: Array<Pattern> = [];
  for (const name of order) {
    const instance = byName.get(name);
    if (!instance) {
      res.status(400).json({ error: `Unknown or duplicate pattern name: ${name}` });
      return;
    }
    byName.delete(name);
    reordered.push(instance);
  }

  individualPatterns = reordered;
  persist();
  res.json(individualPatterns.map((p) => p.name));
}

// Blend the existing individual patterns into a single flat RGB array
function blendPatterns(): number[] {
  // Each layer is flat RGBA ([r, g, b, a, ...]); alpha is the compositing weight.
  const layers = individualPatterns.map((p) => p.data());
  const { nLights } = config;
  const out = new Array<number>(nLights * 3).fill(0);

  // Source-over alpha compositing, first pattern on the bottom, last on top
  for (const layer of layers) {
    for (let i = 0; i < nLights; i++) {
      const src = i * 4;
      const dst = i * 3;
      const sr = layer[src];
      const sg = layer[src + 1];
      const sb = layer[src + 2];
      const alpha = layer[src + 3];

      out[dst] = sr * alpha + out[dst] * (1 - alpha);
      out[dst + 1] = sg * alpha + out[dst + 1] * (1 - alpha);
      out[dst + 2] = sb * alpha + out[dst + 2] * (1 - alpha);
    }
  }

  return out.map((v) => Math.round(v * brightnessFactor));
}

// Return the blended frame over HTTP
function pattern(_req: express.Request, res: express.Response) {
  res.json(blendPatterns());
}

// Return the stored pattern library
function storedPatterns(_req: express.Request, res: express.Response) {
  res.json(library);
}

// Store the current active list as one named set, replacing any set with the same name
async function storePatterns(req: express.Request, res: express.Response) {
  const { name } = req.body ?? {};

  if (typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ error: `Missing name for stored pattern set` });
    return;
  }

  const entry: StoredPatternSet = {
    name,
    patterns: individualPatterns.map((p) => p.parameters() as PatternParameters)
  };

  const index = library.findIndex((e) => e.name === name);
  if (index === -1) {
    library.push(entry);
  } else {
    library[index] = entry;
  }

  try {
    await saveLibrary(library);
  } catch (err) {
    console.error('Failed to save library:', err);
    res.status(500).json({ error: 'Failed to store patterns' });
    return;
  }

  res.json(library);
}

// Re-add every pattern from a stored set, skipping names that already exist
function addStoredPatterns(req: express.Request, res: express.Response) {
  const { name } = req.body ?? {};

  const entry = library.find((e) => e.name === name);
  if (!entry) {
    res.status(404).json({ error: `No stored pattern set named: ${name}` });
    return;
  }

  const existing = new Set(individualPatterns.map((p) => p.name));
  for (const params of entry.patterns) {
    if (existing.has(params.name)) continue;

    const instance = patternFromParameters(params);
    if (!instance) {
      console.warn(`Skipping unknown stored pattern type: ${params.type}`);
      continue;
    }

    individualPatterns.push(instance);
    existing.add(instance.name);
  }

  persist();
  res.json(individualPatterns.map((p) => p.parameters()));
}

// Rename a stored set, keeping its patterns intact
async function renameStoredPattern(req: express.Request, res: express.Response) {
  const { name, newName } = req.body ?? {};

  if (typeof newName !== 'string' || newName.trim() === '') {
    res.status(400).json({ error: `Missing new name for stored pattern set` });
    return;
  }

  const trimmed = newName.trim();

  const index = library.findIndex((e) => e.name === name);
  if (index === -1) {
    res.status(404).json({ error: `No stored pattern set named: ${name}` });
    return;
  }

  if (trimmed !== name && library.some((e) => e.name === trimmed)) {
    res
      .status(400)
      .json({ error: `A stored pattern set named ${trimmed} already exists` });
    return;
  }

  library[index] = { ...library[index], name: trimmed };

  try {
    await saveLibrary(library);
  } catch (err) {
    console.error('Failed to save library:', err);
    res.status(500).json({ error: 'Failed to rename stored pattern' });
    return;
  }

  res.json(library);
}

// Remove a stored set from the library
async function removeStoredPattern(req: express.Request, res: express.Response) {
  const { name } = req.body ?? {};

  const index = library.findIndex((e) => e.name === name);
  if (index === -1) {
    res.status(404).json({ error: `No stored pattern set named: ${name}` });
    return;
  }

  library.splice(index, 1);

  try {
    await saveLibrary(library);
  } catch (err) {
    console.error('Failed to save library:', err);
    res.status(500).json({ error: 'Failed to remove stored pattern' });
    return;
  }

  res.json({ name });
}

async function main() {
  // Restore any patterns saved from a previous run before serving requests.
  individualPatterns = await loadPatterns();
  library = await loadLibrary();

  const app = express();

  app.use(cors());
  app.use(express.json());

  // All endpoints live under /api so a single proxy/CORS rule covers them.
  const routes = express.Router();
  routes.get('/current_patterns', currentPatterns);
  routes.post('/add_new_pattern', addNewPattern);
  routes.post('/remove_new_pattern', removePattern);
  routes.post('/update_pattern', updatePattern);
  routes.get('/server_paused', serverPausedState);
  routes.post('/set_server_paused', setServerPaused);
  routes.get('/blackout', blackoutState);
  routes.post('/set_blackout', setBlackout);
  routes.post('/reorder_patterns', reorderPatterns);
  routes.get('/pattern', pattern);
  routes.get('/stored_patterns', storedPatterns);
  routes.post('/store_patterns', storePatterns);
  routes.post('/add_stored_patterns', addStoredPatterns);
  routes.post('/rename_stored_pattern', renameStoredPattern);
  routes.post('/remove_stored_pattern', removeStoredPattern);
  app.use('/api', routes);

  // Advance every pattern at a fixed rate so animations progress over time
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;

    // Ease the global pause scale toward its target so pausing and resuming
    // ramp the animation speed instead of snapping it.
    const target = serverPaused ? 0 : 1;
    const transition = config.server['pause-transition'];
    const step = transition > 0 ? dt / transition : 1;
    if (pauseFactor < target) pauseFactor = Math.min(target, pauseFactor + step);
    else if (pauseFactor > target) pauseFactor = Math.max(target, pauseFactor - step);

    const scaledDt = dt * pauseFactor;
    for (const p of individualPatterns) {
      p.tick(scaledDt);
    }

    // Ease the master brightness toward its target so the blackout fades
    // out and back in instead of snapping.
    const brightnessTarget = blackout ? 0 : 1;
    const fade = config.server['blackout-transition'];
    const brightnessStep = fade > 0 ? dt / fade : 1;
    if (brightnessFactor < brightnessTarget)
      brightnessFactor = Math.min(brightnessTarget, brightnessFactor + brightnessStep);
    else if (brightnessFactor > brightnessTarget)
      brightnessFactor = Math.max(brightnessTarget, brightnessFactor - brightnessStep);
  }, 1000 / config.server['tick-rate']);

  // Share the blended frame over DMX-512 and/or Art-Net when enabled in config.json
  await startOutputs(blendPatterns);

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
