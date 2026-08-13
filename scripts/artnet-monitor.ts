import dgram from 'node:dgram';
import process from 'node:process';

import config from '../config.json' with { type: 'json' };

const ART_NET_ID = 'Art-Net\0';
const ART_NET_PORT = 6454;
const OP_POLL = 0x2000;
const OP_POLL_REPLY = 0x2100;
const OP_DMX = 0x5000;
const POLL_LISTEN_MS = 2000;
// Art-Net nodes expect a controller to poll at least every 3 s to stay known to them.
const POLL_INTERVAL_MS = 2500;
const DMX_TIMEOUT_MS = 3000;

interface Options {
  host: string;
  watch: boolean;
  poll: boolean;
}

const USAGE = `Inspect the Art-Net nodes and lighting data on the network.

Usage: npm run artnet -- [options]

Options:
  --host <ip>  Node address to poll  (default: config.json output.artnet.host)
  --poll       Ask nodes to identify themselves (ArtPoll) instead of printing levels
  --watch      Keep printing ArtDmx until Ctrl+C, instead of stopping at the first packet
  --help       Show this message`;

function parseArgs(argv: string[]): Options {
  const options: Options = {
    host: config.output.artnet.host,
    watch: false,
    poll: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--host':
        options.host = argv[++i] ?? options.host;
        break;
      case '--poll':
        options.poll = true;
        break;
      case '--watch':
        options.watch = true;
        break;
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}\n\n${USAGE}`);
        process.exit(1);
    }
  }
  return options;
}

function printFrame(channels: Buffer, label: string): void {
  const active: string[] = [];
  for (let i = 0; i < channels.length; i++) {
    if (channels[i] !== 0) active.push(`${i + 1}:${String(channels[i]).padStart(3)}`);
  }

  const time = new Date().toLocaleTimeString();
  console.log(
    `\n[${time}] ${label} — ${active.length} of ${channels.length} channels above 0`
  );
  if (active.length === 0) {
    console.log('  all channels at 0');
    return;
  }
  for (let i = 0; i < active.length; i += 8) {
    console.log(`  ${active.slice(i, i + 8).join('  ')}`);
  }
}

function readName(reply: Buffer, start: number, length: number): string {
  if (reply.length < start + length) return '';
  return reply
    .toString('latin1', start, start + length)
    .replace(/\0.*$/s, '')
    .trim();
}

function printPollReply(reply: Buffer, from: string): void {
  console.log(`\nArtPollReply from ${from}`);
  console.log(`  Node IP    : ${Array.from(reply.subarray(10, 14)).join('.')}`);
  console.log(`  Short name : ${readName(reply, 26, 18)}`);
  console.log(`  Long name  : ${readName(reply, 44, 64)}`);
  console.log(`  Firmware   : ${reply[16]}.${reply[17]}`);
  console.log(`  Net/Subnet : ${reply[18]}/${reply[19]}`);
  if (reply.length >= 178) {
    const types = Array.from(reply.subarray(174, 178), (t) => `0x${t.toString(16)}`);
    console.log(`  Ports      : ${reply.readUInt16BE(172)} (types ${types.join(' ')})`);
  }
  const report = readName(reply, 108, 64);
  if (report) console.log(`  Report     : ${report}`);
}

function buildArtPoll(): Buffer {
  const poll = Buffer.alloc(14);
  poll.write(ART_NET_ID, 0, 'latin1');
  poll.writeUInt16LE(OP_POLL, 8);
  poll.writeUInt8(14, 11); // ProtVerLo
  return poll;
}

// Nodes answer on port 6454, so the socket has to be bound there — this will fail while
// another Art-Net application on this machine holds that port.
function bindArtNet(onMessage: (msg: Buffer, from: string) => void): dgram.Socket {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('message', (msg, rinfo) => {
    if (msg.length >= 12 && msg.toString('latin1', 0, 8) === ART_NET_ID) {
      onMessage(msg, rinfo.address);
    }
  });
  socket.on('error', (err) => {
    console.error(`Socket error: ${err.message}`);
    process.exit(1);
  });
  return socket;
}

function runArtPoll(options: Options): void {
  let replies = 0;
  const socket = bindArtNet((msg, from) => {
    if (msg.length < 108 || msg.readUInt16LE(8) !== OP_POLL_REPLY) return;
    replies++;
    printPollReply(msg, from);
  });

  socket.bind(ART_NET_PORT, () => {
    socket.setBroadcast(true);
    console.log(
      `Sending ArtPoll to ${options.host}:${ART_NET_PORT}, listening for ${POLL_LISTEN_MS} ms…`
    );
    socket.send(buildArtPoll(), ART_NET_PORT, options.host, (err) => {
      if (err) console.error(`Send error: ${err.message}`);
    });
  });

  setTimeout(() => {
    socket.close();
    if (replies === 0) {
      console.error('\nNo ArtPollReply received.');
      process.exitCode = 1;
    }
  }, POLL_LISTEN_MS);
}

// Print the levels carried by every ArtDmx packet seen on the network: what a controller
// sends to a node, and what a node reports from its own DMX input port.
function runArtDmxListen(options: Options): void {
  let frames = 0;
  let pollTimer: NodeJS.Timeout | null = null;
  let timeout: NodeJS.Timeout | null = null;

  const finish = () => {
    if (pollTimer) clearInterval(pollTimer);
    if (timeout) clearTimeout(timeout);
    socket.close();
  };

  const socket = bindArtNet((msg, from) => {
    if (msg.length < 18 || msg.readUInt16LE(8) !== OP_DMX) return;

    const universe = `${msg[15] & 0x7f}:${(msg[14] >> 4) & 0x0f}:${msg[14] & 0x0f}`;
    const length = Math.min(msg.readUInt16BE(16), msg.length - 18);
    frames++;
    printFrame(
      msg.subarray(18, 18 + length),
      `ArtDmx from ${from}, universe ${universe}, seq ${msg[12]}`
    );
    if (!options.watch) finish();
  });

  socket.bind(ART_NET_PORT, () => {
    socket.setBroadcast(true);
    console.log(
      `Listening for ArtDmx on port ${ART_NET_PORT}` +
        (options.watch ? ' — Ctrl+C to stop' : '…')
    );

    // A node only streams its DMX input to controllers it has seen, so keep polling.
    const poll = () =>
      socket.send(buildArtPoll(), ART_NET_PORT, options.host, (err) => {
        if (err) console.error(`Send error: ${err.message}`);
      });
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);

    if (options.watch) return;
    timeout = setTimeout(() => {
      console.error(
        `No ArtDmx within ${DMX_TIMEOUT_MS} ms. Nothing on the network is sending this ` +
          "way; enable an Art-Net output or the node's DMX input port."
      );
      process.exitCode = 1;
      finish();
    }, DMX_TIMEOUT_MS);
  });

  process.on('SIGINT', () => {
    console.log(`\nStopped after ${frames} frame(s).`);
    finish();
  });
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.poll) runArtPoll(options);
  else runArtDmxListen(options);
}

main();
