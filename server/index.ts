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

  const { name } = props ?? '';

  if (name === '') {
    res.status(400).json({ error: `Missing name for new pattern` });
    return;
  }

  if (individualPatterns.find((p) => p.name === name)) {
    res.status(400).json({ error: `Pattern Missing name for new pattern` });
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
  const layers = individualPatterns.map((p) => p.data());
  const length = layers[0]?.length ?? 0;
  const out = new Array<number>(length).fill(0);

  // Source-over alpha compositing, first pattern on the bottom, last on top
  for (const layer of layers) {
    for (let i = 0; i < length; i += 3) {
      const sr = layer[i];
      const sg = layer[i + 1];
      const sb = layer[i + 2];

      // No dedicated alpha channel, so derive it from pixel brightness
      const alpha = Math.max(sr, sg, sb) / 255;
      out[i] = sr * alpha + out[i] * (1 - alpha);
      out[i + 1] = sg * alpha + out[i + 1] * (1 - alpha);
      out[i + 2] = sb * alpha + out[i + 2] * (1 - alpha);
    }
  }

  return out.map(Math.round);
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

  app.get('/current_patterns', currentPatterns);
  app.post('/add_new_pattern', addNewPattern);
  app.post('/remove_new_pattern', removePattern);
  app.post('/update_pattern', updatePattern);
  app.post('/reorder_patterns', reorderPatterns);
  app.get('/pattern', pattern);
  app.get('/stored_patterns', storedPatterns);
  app.post('/store_patterns', storePatterns);
  app.post('/add_stored_patterns', addStoredPatterns);
  app.post('/remove_stored_pattern', removeStoredPattern);

  // Advance every pattern at a fixed rate so animations progress over time
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    for (const p of individualPatterns) {
      p.tick(dt);
    }
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
