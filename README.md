# C-Lux

C-Lux is a small full-stack app for composing and previewing animated lighting patterns
on a circular display of addressable LEDs. A React + Mantine UI lets you build up a stack
of individual patterns, tune their parameters, reorder them, and watch the blended result
render live in a circular visualizer. A lightweight Express backend holds the pattern state,
advances animations on a fixed tick, and serves the composited frame.

## Features

- **Pattern management** — add, edit, remove, and reorder patterns from the UI.
- **Live blend** — the server alpha-composites all patterns (first is the bottom layer, last
  on top) and exposes the result as a flat RGB array.
- **Circular visualizer** — a canvas renders all lights counterclockwise around a ring and
  polls the server, backing off automatically when the backend is unreachable.
- **Server-driven animation** — a fixed-rate tick advances every pattern so moving patterns
  animate over time.
- **Registry-based patterns** — patterns are defined once and registered in a single list;
  the shared type list (`PatternType`, `PATTERN_TYPES`, `PatternParameters`) is derived
  automatically, so adding a new pattern requires no central type edits.

## Tech stack

- **Frontend:** Vite, React, TypeScript, Mantine
- **Backend:** Node.js, Express (run with `tsx`)

## Getting started

```powershell
npm install
npm run all
```

`npm run all` starts both processes together:

- Web (Vite dev server): http://localhost:5173
- API (Express): http://localhost:8787

The Vite dev server proxies the pattern endpoints to the API, so the UI works out of the box.

## Scripts

| Script            | Description                                        |
| ----------------- | -------------------------------------------------- |
| `npm run all`     | Run the web and API processes concurrently         |
| `npm run dev`     | Start only the Vite dev server                     |
| `npm run server`  | Start only the Express API (watch mode)            |
| `npm run build`   | Type-check and build the frontend                  |
| `npm run preview` | Preview the production build                       |
| `npm run lint`    | Check formatting and lint                          |

## API

All endpoints are served by the Express backend and proxied through Vite in development.

| Method | Path                  | Body                        | Description                              |
| ------ | --------------------- | --------------------------- | ---------------------------------------- |
| GET    | `/current_patterns`   | —                           | List the active patterns' parameters     |
| POST   | `/add_new_pattern`    | `{ type, props }`           | Add a pattern of the given type          |
| POST   | `/update_pattern`     | `{ name, props }`           | Update an existing pattern by name       |
| POST   | `/remove_new_pattern` | `{ name }`                  | Remove a pattern by name                 |
| POST   | `/reorder_patterns`   | `{ order: string[] }`       | Reorder patterns (controls blend order)  |
| GET    | `/pattern`            | —                           | The blended frame as a flat RGB array    |

## Configuration

Global settings live in [`config.json`](config.json) and are read by both the server and the
visualizer:

```json
{
  "nLights": 142,
  "server": {
    "tick-rate": 30,
    "port": 8787,
    "storage": "patterns.json",
    "library": "library.json"
  },
  "output": {
    "dmx": {
      "enabled": false,
      "device": "COM3",
      "startChannel": 1,
      "refreshRate": 40
    },
    "artnet": {
      "enabled": false,
      "host": "255.255.255.255",
      "port": 6454,
      "net": 0,
      "subnet": 0,
      "universe": 0,
      "startChannel": 1,
      "refreshRate": 40
    }
  }
}
```

### Sharing lighting data (DMX-512 & Art-Net)

The blended frame can be streamed live to lighting hardware. Each output is independent and
disabled by default; set `enabled` to `true` to turn one on. RGB values map to consecutive
DMX channels starting at `startChannel`, and `refreshRate` is the send rate in frames per
second.

- **`output.dmx`** — physical DMX-512 through an Enttec-compatible USB widget (e.g. DMX USB
  Pro). Set `device` to the serial port (`COM3` on Windows, `/dev/ttyUSB0` on Linux). One
  universe (512 channels) is sent.
- **`output.artnet`** — Art-Net over the network. Point `host` at a node's IP or a broadcast
  address, and set the `net`/`subnet`/`universe` addressing. Frames longer than 512 channels
  are split across consecutive universes automatically.

> Enabling `output.dmx` loads the native `serialport` binding. If your package manager blocked
> its install scripts, allow them (e.g. `npm install-scripts approve @serialport/bindings-cpp`)
> before enabling DMX output.


## Adding a pattern

1. Create a class under `server/patterns/` that extends `Pattern`, with a static `Type`
   tag and a `parameters()` method describing its shape.
2. Register it in the `PATTERNS` array in
   [`server/patterns/patterns.ts`](server/patterns/patterns.ts).

The available pattern types and their parameter shapes are derived from that list, so the
UI and shared types pick up the new pattern automatically.

## Project structure

```
config.json              Global configuration (light count)
server/
  index.ts               Express app, routes, and the animation tick loop
  patterns/
    pattern.ts           Abstract Pattern base class
    patterns.ts          Pattern registry and derived types
    static.ts            StaticPattern
    moving-gaussian.ts   MovingGaussianPattern
src/
  App.tsx                Mantine UI and circular visualizer
  lib/api.ts             Typed client for the pattern API
```

