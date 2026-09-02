import { config } from '../config';

import { ArtNetSender } from './artnet';

// A running output that periodically pushes the current frame and can be stopped.
interface Output {
  stop(): void;
}

// Start every enabled lighting-data output (Art-Net) based on config.json.
// `getFrame` returns the current blended frame as a flat RGB array of 8-bit values.
export function startOutputs(getFrame: () => number[]): Output[] {
  const outputs: Output[] = [];
  const { artnet } = config.output;
  const getOutputFrame = withRemap(withRotation(getFrame));

  if (artnet.enabled) {
    const sender = new ArtNetSender(artnet);
    const timer = setInterval(
      () => sender.send(getOutputFrame()),
      1000 / artnet.refreshRate
    );
    outputs.push({
      stop() {
        clearInterval(timer);
        sender.close();
      }
    });
    console.log(
      `Art-Net output enabled -> ${artnet.host}:${artnet.port} ` +
        `(net ${artnet.net}, subnet ${artnet.subnet}, universe ${artnet.universe})`
    );
  }

  return outputs;
}

// Wrap a frame source so the ring is rotated by `output.rotation` degrees before it
// reaches the hardware. The visualizer keeps light 0 at the top; this compensates for
// where light 0 physically sits on the installation. Positive angles shift the pattern
// along the strip (light 0 of the frame lands on light `offset` of the fixture).
function withRotation(getFrame: () => number[]): () => number[] {
  const { nLights } = config;
  const offset =
    ((Math.round((config.output.rotation / 360) * nLights) % nLights) + nLights) %
    nLights;
  if (offset === 0) return getFrame;

  const rotated = new Array<number>(nLights * 3).fill(0);
  return () => {
    const frame = getFrame();
    for (let i = 0; i < nLights; i++) {
      const src = i * 3;
      const dst = ((i + offset) % nLights) * 3;
      rotated[dst] = frame[src];
      rotated[dst + 1] = frame[src + 1];
      rotated[dst + 2] = frame[src + 2];
    }
    return rotated;
  };
}

// Wrap a frame source so individual lights are re-addressed before they reach the hardware,
// compensating for fixtures that sit on a different DMX address than their position implies.
// Lights missing from `output.remap` keep their 1:1 mapping. Entries may be one-way: an
// explicit entry outranks the 1:1 mapping of the light it lands on, and a light whose color
// was sent elsewhere goes dark unless another entry fills its place.
function withRemap(getFrame: () => number[]): () => number[] {
  const { nLights } = config;
  const entries = Object.entries(config.output.remap);
  if (entries.length === 0) return getFrame;

  const moved = new Set(entries.map(([from]) => Number(from)));
  const sources = new Array<number | null>(nLights).fill(null);
  for (const [from, to] of entries) sources[to] = Number(from);
  for (let i = 0; i < nLights; i++) {
    if (sources[i] === null && !moved.has(i)) sources[i] = i;
  }

  const remapped = new Array<number>(nLights * 3).fill(0);
  return () => {
    const frame = getFrame();
    for (let i = 0; i < nLights; i++) {
      const source = sources[i];
      const dst = i * 3;
      if (source === null) {
        remapped[dst] = 0;
        remapped[dst + 1] = 0;
        remapped[dst + 2] = 0;
        continue;
      }
      const src = source * 3;
      remapped[dst] = frame[src];
      remapped[dst + 1] = frame[src + 1];
      remapped[dst + 2] = frame[src + 2];
    }
    return remapped;
  };
}
