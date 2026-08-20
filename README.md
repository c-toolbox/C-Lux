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
| GET    | `/api/scenes`                 | —                       | List the saved scenes                   |
| POST   | `/api/scenes`                 | `{ name }`              | Save the active patterns as a scene     |
| POST   | `/api/scenes/:name/apply`     | —                       | Add a scene's patterns to the list      |
| POST   | `/api/scenes/:name/unapply`   | —                       | Remove a scene's patterns from the list |
| POST   | `/api/scenes/:name/replace`   | —                       | Replace the active patterns with a scene|
| POST   | `/api/scenes/reorder`         | `{ order: string[] }`   | Reorder scenes (controls blend order)   |
| PATCH  | `/api/scenes/:name`           | `{ newName }`           | Rename a scene                          |
| DELETE | `/api/scenes/:name`           | —                       | Delete a scene                          |

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
    "scenes": "scenes.json",
    "pause-transition": 1.0,
    "blackout-transition": 1.0,
    "half-light-transition": 1.0,
    "half-light-feather": 0.5
  },
  "output": {
    "rotation": 180,
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
      "endChannel": 0,
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

- **`output.rotation`** — how far, in degrees, the frame is rotated around the ring before
  it is sent to the hardware. Patterns and the visualizer always treat light 0 as the top of
  the ring; this compensates for where light 0 physically sits. For example, if light 0 is at
  the back of a dome, `180` puts the pattern's 0 point at the front. Only the outputs are
  affected, the visualizer is not.

- **`output.dmx`** — physical DMX-512 through an Enttec-compatible USB widget (e.g. DMX USB
  Pro). Set `device` to the serial port (`COM3` on Windows, `/dev/ttyUSB0` on Linux). One
  universe (512 channels) is sent.
- **`output.artnet`** — Art-Net over the network. Point `host` at a node's IP or a broadcast
  address, and set the `net`/`subnet`/`universe` addressing. Only channels between
  `startChannel` and `endChannel` (both 1-based and inclusive) are transmitted; set
  `endChannel` to `0` to send the whole frame. Frames longer than 512 channels
  are split across consecutive universes automatically. The node's DMX output port must be
  set to the same universe, or it ignores the frames.

  `npm run artnet` prints the channel levels of the ArtDmx traffic on the network, i.e. the
  current state of the lights (`--watch` to keep printing, `--poll` to make nodes identify
  themselves and report their universes, `--help` for the options).

> Enabling `output.dmx` loads the native `serialport` binding. If your package manager blocked
> its install scripts, allow them (e.g. `npm install-scripts approve @serialport/bindings-cpp`)
> before enabling DMX output.


## Adding a pattern

1. Create a class under `server/patterns/` that extends `Pattern`, with a static `Type`
   tag, a static `Fields` schema describing its configurable parameters, and a
   `parameters()` method describing its shape.
2. Register it in the `PATTERNS` array in
   [`server/patterns/patterns.ts`](server/patterns/patterns.ts).

The available pattern types and their parameter shapes are derived from that list, so the
UI and shared types pick up the new pattern automatically. `Fields` is the single source
of truth for each parameter's label, default and allowed range: the server validates
incoming props against it and the browser generates the edit form from it.

## Project structure

```
config.json              Global configuration (light count, tick rate, outputs)
server/
  index.ts               Express app, REST routes, SSE stream, and the tick loop
  engine.ts              PatternEngine: state, blending, ticking, and persistence
  errors.ts              HttpError used by handlers and the error middleware
  storage.ts             Persistence for the active pattern list and the saved scenes
  output/                DMX-512 and Art-Net streaming outputs
  patterns/
    pattern.ts           Abstract Pattern base class
    patterns.ts          Pattern registry and derived types
    *.ts                 Concrete patterns (static, moving-gaussian, fire, comet, …)
src/
  main.tsx               App entry, Mantine theme, and router
  Editor/                Pattern editor UI
  HomePage/              Landing page with global controls
  PatternForm/           Parameter form generated from a pattern's `Fields` schema
  PatternVisualizer/     Circular canvas that renders the streamed blended frame
  lib/api.ts             Typed client for the pattern API
scripts/
  artnet-monitor.ts      Prints Art-Net nodes and the DMX levels seen on the network
```

