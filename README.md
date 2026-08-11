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
  receives frames over a Server-Sent Events stream, reconnecting automatically if the
  backend drops.
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
| `npm start`       | Run the API in production (serves the built SPA)   |
| `npm run preview` | Preview the production build                       |
| `npm run lint`    | Check formatting and lint                          |

For a production run, build first and then start the server, which serves the built SPA
from `dist/` on the same origin:

```powershell
npm run build
npm start
```

## API

All endpoints are served by the Express backend under the `/api` prefix and proxied through
Vite in development.

| Method | Path                          | Body                    | Description                             |
| ------ | ----------------------------- | ----------------------- | --------------------------------------- |
| GET    | `/api/patterns`               | —                       | List the active patterns' parameters    |
| POST   | `/api/patterns`               | `{ type, props }`       | Add a pattern of the given type         |
| PATCH  | `/api/patterns/:name`         | `{ props }`             | Update an existing pattern by name      |
| DELETE | `/api/patterns/:name`         | —                       | Remove a pattern by name                |
| POST   | `/api/patterns/reorder`       | `{ order: string[] }`   | Reorder patterns (controls blend order) |
| GET    | `/api/pause`                  | —                       | Whether the server is paused            |
| PUT    | `/api/pause`                  | `{ paused }`            | Pause or resume all patterns            |
| GET    | `/api/blackout`               | —                       | Whether the master blackout is engaged  |
| PUT    | `/api/blackout`               | `{ blackout }`          | Fade output to black or restore it      |
| GET    | `/api/half-light`             | —                       | Whether half-light mode is engaged      |
| PUT    | `/api/half-light`             | `{ halfLight }`         | Fade the top half out or restore it     |
| GET    | `/api/frame`                  | —                       | The blended frame as a flat RGB array   |
| GET    | `/api/stream`                 | —                       | Server-Sent Events stream of frames     |
| GET    | `/api/library`                | —                       | List the stored pattern sets            |
| POST   | `/api/library`                | `{ name }`              | Store the active list as a named set    |
| POST   | `/api/library/:name/apply`    | —                       | Add a stored set's patterns to the list |
| PATCH  | `/api/library/:name`          | `{ newName }`           | Rename a stored set                     |
| DELETE | `/api/library/:name`          | —                       | Remove a stored set                     |

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
    "library": "library.json",
    "pause-transition": 1.0,
    "blackout-transition": 1.0,
    "half-light-transition": 1.0,
    "half-light-feather": 0.5
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
config.json              Global configuration (light count, tick rate, outputs)
server/
  index.ts               Express app, REST routes, SSE stream, and the tick loop
  engine.ts              PatternEngine: state, blending, ticking, and persistence
  errors.ts              HttpError used by handlers and the error middleware
  storage.ts             Persistence for the active list and the pattern library
  output/                DMX-512 and Art-Net streaming outputs
  patterns/
    pattern.ts           Abstract Pattern base class
    patterns.ts          Pattern registry and derived types
    *.ts                 Concrete patterns (static, moving-gaussian, fire, comet, …)
src/
  main.tsx               App entry, Mantine theme, and router
  Editor/                Pattern editor UI
  HomePage/              Landing page with global controls
  PatternForm/           Per-pattern parameter forms
  PatternVisualizer/     Circular canvas that renders the streamed blended frame
  lib/api.ts             Typed client for the pattern API
```

