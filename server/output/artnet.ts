import dgram from 'node:dgram';

interface ArtNetConfig {
  host: string;
  port: number;
  net: number;
  subnet: number;
  universe: number;
  startChannel: number;
  // Last channel to transmit (1-based, inclusive). Use 0 to send everything.
  endChannel: number;
  // Channels per universe before rolling over to the next port address.
  universeSize: number;
  refreshRate: number;
}

const ART_NET_ID = 'Art-Net\0';
const OP_DMX = 0x5000;
const PROTOCOL_VERSION = 14;

// Streams DMX channel data over the network using the Art-Net protocol (ArtDmx packets).
// Channel data longer than one universe (512 slots) is automatically split across
// consecutive universes starting from the configured base address.
export class ArtNetSender {
  private readonly socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  private sequence = 0;
  private ready = false;

  constructor(private readonly config: ArtNetConfig) {
    this.socket.on('error', (err) => {
      console.error('Art-Net socket error:', err.message);
    });
    this.socket.bind(() => {
      // Allow broadcast addresses (e.g. 255.255.255.255) to reach every node.
      this.socket.setBroadcast(true);
      this.ready = true;
    });
  }

  // Send a flat array of 8-bit channel values, limited to the configured channel window.
  send(channels: number[]): void {
    if (!this.ready) return;

    const offset = Math.max(0, this.config.startChannel - 1);
    let frame = new Array<number>(offset).fill(0).concat(channels);

    const { endChannel } = this.config;
    if (endChannel > 0) {
      if (endChannel <= offset) return;
      frame = frame.slice(0, endChannel);
    }

    const basePort =
      ((this.config.net & 0x7f) << 8) |
      ((this.config.subnet & 0x0f) << 4) |
      (this.config.universe & 0x0f);

    const { universeSize } = this.config;
    for (let i = 0; i < frame.length; i += universeSize) {
      const slice = frame.slice(i, i + universeSize);
      const portAddress = basePort + i / universeSize;
      this.sendUniverse(portAddress, slice);
    }
  }

  close(): void {
    this.socket.close();
  }

  private sendUniverse(portAddress: number, data: number[]): void {
    // The ArtDmx data length must be even and between 2 and 512.
    const length = Math.max(2, data.length + (data.length % 2));
    const buffer = Buffer.alloc(18 + length);

    buffer.write(ART_NET_ID, 0, 'latin1');
    buffer.writeUInt16LE(OP_DMX, 8);
    buffer.writeUInt8(0, 10); // ProtVerHi
    buffer.writeUInt8(PROTOCOL_VERSION, 11); // ProtVerLo
    this.sequence = (this.sequence % 255) + 1;
    buffer.writeUInt8(this.sequence, 12);
    buffer.writeUInt8(0, 13); // Physical
    buffer.writeUInt8(portAddress & 0xff, 14); // SubUni (low byte)
    buffer.writeUInt8((portAddress >> 8) & 0x7f, 15); // Net (high byte)
    buffer.writeUInt8((length >> 8) & 0xff, 16); // LengthHi
    buffer.writeUInt8(length & 0xff, 17); // LengthLo

    for (let i = 0; i < data.length; i++) {
      buffer.writeUInt8(clampChannel(data[i]), 18 + i);
    }

    this.socket.send(buffer, this.config.port, this.config.host, (err) => {
      if (err) console.error('Art-Net send error:', err.message);
    });
  }
}

function clampChannel(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return Math.round(value);
}
