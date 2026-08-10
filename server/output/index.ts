import config from '../../config.json' with { type: 'json' };

import { ArtNetSender } from './artnet';
import { DmxSender } from './dmx';

// A running output that periodically pushes the current frame and can be stopped.
export interface Output {
  stop(): void;
}

// Start every enabled lighting-data output (DMX-512 and/or Art-Net) based on config.json.
// `getFrame` returns the current blended frame as a flat RGB array of 8-bit values.
export async function startOutputs(getFrame: () => number[]): Promise<Output[]> {
  const outputs: Output[] = [];
  const { dmx, artnet } = config.output;

  if (artnet.enabled) {
    const sender = new ArtNetSender(artnet);
    const timer = setInterval(() => sender.send(getFrame()), 1000 / artnet.refreshRate);
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

  if (dmx.enabled) {
    const sender = new DmxSender(dmx);
    await sender.open();
    const timer = setInterval(() => sender.send(getFrame()), 1000 / dmx.refreshRate);
    outputs.push({
      stop() {
        clearInterval(timer);
        sender.close();
      }
    });
    console.log(`DMX-512 output enabled -> ${dmx.device}`);
  }

  return outputs;
}
