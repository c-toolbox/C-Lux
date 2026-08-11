export interface DmxConfig {
  enabled: boolean;
  device: string;
  startChannel: number;
  refreshRate: number;
}

// Enttec USB DMX Pro widget message framing.
const START_OF_MESSAGE = 0x7e;
const END_OF_MESSAGE = 0xe7;
const LABEL_SEND_DMX = 6;
const DMX_START_CODE = 0x00;
const UNIVERSE_SIZE = 512;
const BAUD_RATE = 57600;

// Minimal SerialPort surface used here, so the native module stays a dynamic import.
interface SerialLike {
  write(data: Buffer): boolean;
  once(event: 'drain', listener: () => void): void;
  close(cb?: (err?: Error | null) => void): void;
}

// Streams DMX channel data to a physical DMX-512 universe through an Enttec-compatible
// USB widget (e.g. the DMX USB Pro). The serialport dependency is imported lazily so the
// server can run without the native binding when DMX output is disabled.
export class DmxSender {
  private port: SerialLike | null = null;
  private ready = false;

  // Set while the serial buffer is full; frames are dropped until the port drains.
  private backpressured = false;

  constructor(private readonly config: DmxConfig) {}

  async open(): Promise<void> {
    const { SerialPort } = await import('serialport');
    await new Promise<void>((resolve) => {
      const port = new SerialPort(
        { path: this.config.device, baudRate: BAUD_RATE },
        (err) => {
          if (err) {
            console.error(`DMX: failed to open ${this.config.device}:`, err.message);
            resolve();
            return;
          }
          this.port = port;
          this.ready = true;
          resolve();
        }
      );
      port.on('error', (err) => {
        console.error('DMX serial error:', err.message);
      });
    });
  }

  // Send a flat array of 8-bit channel values, offset by the configured start channel.
  send(channels: number[]): void {
    if (!this.ready || !this.port) return;

    // Every message is a complete universe, so a frame the widget can't keep up with is
    // worth dropping: queueing it would only grow the backlog and show stale data.
    if (this.backpressured) return;

    const offset = Math.max(0, this.config.startChannel - 1);
    const frame = Buffer.alloc(UNIVERSE_SIZE + 1);
    frame[0] = DMX_START_CODE;
    for (let i = 0; i < channels.length && offset + i < UNIVERSE_SIZE; i++) {
      frame[1 + offset + i] = clampChannel(channels[i]);
    }

    const header = Buffer.from([
      START_OF_MESSAGE,
      LABEL_SEND_DMX,
      frame.length & 0xff,
      (frame.length >> 8) & 0xff
    ]);
    const message = Buffer.concat([header, frame, Buffer.from([END_OF_MESSAGE])]);

    if (!this.port.write(message)) {
      this.backpressured = true;
      this.port.once('drain', () => {
        this.backpressured = false;
      });
    }
  }

  close(): void {
    this.ready = false;
    this.backpressured = false;
    this.port?.close();
    this.port = null;
  }
}

function clampChannel(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return Math.round(value);
}
