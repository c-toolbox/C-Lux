# C-Lux

C-Lux is a small full-stack app for composing and previewing animated lighting patterns
on a circular display of addressable LEDs. A React + Mantine UI lets you build up a stack
of individual patterns, tune their parameters, reorder them, and watch the blended result
render live in a circular visualizer. A lightweight Express backend holds the pattern state,
advances animations on a fixed tick, and serves the composited frame.

## Features

- **Pattern management** — add, edit, remove, and reorder patterns from the UI.
- **Scenes** — the active pattern stack is held in memory only, so save it as a scene (or
  export it to a JSON file) to keep it across a restart.
- **Live blend** — the server alpha-composites all patterns (first is the bottom layer, last
  on top) and exposes the result as a flat RGB array.
- **Circular visualizer** — a canvas renders all lights counterclockwise around a ring and
  receives frames over a Server-Sent Events stream, reconnecting automatically if the
  backend drops.
- **Server-driven animation** — a fixed-rate tick advances every pattern so moving patterns
  animate over time.

## Tech stack

- **Frontend:** Vite, React, TypeScript, Mantine
- **Backend:** Node.js, Express (run with `tsx`)

## Getting started

Requires Node.js 22 or newer.

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
| `npm run build`   | Type-check and build the frontend and server       |
| `npm start`       | Run the compiled API (serves the built SPA)        |
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
Vite in development. Endpoints marked with a lock require the editor password (see
[Configuration](#configuration)) and answer `401` without it.

| Method | Path                          | Body                    | Description                             |
| ------ | ----------------------------- | ----------------------- | --------------------------------------- |
| GET    | `/api/auth`                   | —                       | Whether the caller's token is still valid |
| POST   | `/api/auth/login`             | `{ password }`          | Exchange the editor password for a token |
| POST   | `/api/auth/logout`            | —                       | Revoke the caller's token               |
| GET    | `/api/patterns`               | —                       | List the active patterns' parameters    |
| POST   | `/api/patterns` 🔒            | `{ type, props }`       | Add a pattern of the given type         |
| PATCH  | `/api/patterns/:name` 🔒      | `{ props }`             | Update an existing pattern by name      |
| DELETE | `/api/patterns/:name` 🔒      | —                       | Remove a pattern by name                |
| POST   | `/api/patterns/reorder` 🔒    | `{ order: string[] }`   | Reorder patterns (controls blend order) |
| POST   | `/api/patterns/clear`         | —                       | Remove every pattern                    |
| GET    | `/api/pause`                  | —                       | Whether the server is paused            |
| PUT    | `/api/pause`                  | `{ paused }`            | Pause or resume all patterns            |
| GET    | `/api/blackout`               | —                       | Whether the master blackout is engaged  |
| PUT    | `/api/blackout`               | `{ blackout }`          | Fade output to black or restore it      |
| GET    | `/api/half-light`             | —                       | Whether half-light mode is engaged      |
| PUT    | `/api/half-light`             | `{ halfLight }`         | Fade the top half out or restore it     |
| GET    | `/api/solid-color`            | —                       | State of the fixed solid color scene     |
| PUT    | `/api/solid-color`            | `{ color?, enabled? }`  | Fade it to a color, or switch it on/off |
| GET    | `/api/frame`                  | —                       | The blended frame as a flat RGB array   |
| GET    | `/api/stream`                 | —                       | Server-Sent Events stream of frames     |
| GET    | `/api/scenes`                 | —                       | List the saved scenes                   |
| POST   | `/api/scenes` 🔒              | `{ name }`              | Save the active patterns as a scene     |
| POST   | `/api/scenes/:name/apply`     | —                       | Add a scene's patterns to the list      |
| POST   | `/api/scenes/:name/unapply`   | —                       | Remove a scene's patterns from the list |
| POST   | `/api/scenes/:name/replace`   | —                       | Replace the active patterns with a scene|
| POST   | `/api/scenes/reorder` 🔒      | `{ order: string[] }`   | Reorder scenes (controls blend order)   |
| PATCH  | `/api/scenes/:name` 🔒        | `{ newName }`           | Rename a scene                          |
| DELETE | `/api/scenes/:name` 🔒        | —                       | Delete a scene                          |

## Configuration

Global settings live in [`config.json`](config.json) and are read by both the server and the
visualizer:

```json
{
  "nLights": 142,
  "server": {
    "tickRate": 30,
    "port": 8787,
    "scenes": "scenes.json",
    "editPassword": "change-me",
    "pauseTransition": 1.0,
    "blackoutTransition": 1.0,
    "halfLightTransition": 1.0,
    "halfLightFeather": 0.5,
    "solidColorTransition": 1.0
  },
  "output": {
    "rotation": 180,
    "remap": {},
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
      "universeSize": 512,
      "refreshRate": 40
    }
  }
}
```

### Editor password

The edit page and every endpoint it drives are behind `server.editPassword`. Set it to
something of your own, or leave it empty and pass the value in the `CLUX_EDIT_PASSWORD`
environment variable instead — the environment wins when both are present.

With no password configured either way the protection is switched off entirely: the edit
page opens without an unlock screen and its endpoints accept anyone. Only do that on a
network where everybody who can reach the server is allowed to drive the lights.

The editor exchanges the password for a token that is good for twelve hours, kept in the
tab's `sessionStorage`, and forgotten when the server restarts. Repeated bad guesses lock
logins out for a few minutes. The password travels in the clear unless the app is behind
HTTPS, so put a TLS-terminating proxy in front of it on an untrusted network.

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

- **`output.remap`** — optional per-light address fix-ups for fixtures that are wired out of
  order. Each entry maps a light index to the index its colour is written to instead, so
  `{ "5": 3, "3": 5 }` swaps that pair. Lights left out keep their 1:1 mapping, and the
  default `{}` changes nothing. Applied after `output.rotation`, and only to the outputs.

- **`output.dmx`** — physical DMX-512 through an Enttec-compatible USB widget (e.g. DMX USB
  Pro). Set `device` to the serial port (`COM3` on Windows, `/dev/ttyUSB0` on Linux). One
  universe (512 channels) is sent.
- **`output.artnet`** — Art-Net over the network. Point `host` at a node's IP or a broadcast
  address, and set the `net`/`subnet`/`universe` addressing. Only channels between
  `startChannel` and `endChannel` (both 1-based and inclusive) are transmitted; set
  `endChannel` to `0` to send the whole frame. Frames longer than `universeSize` channels
  (512 by default, the maximum) are split across consecutive universes automatically. The
  node's DMX output port must be set to the same universe, or it ignores the frames.

> Enabling `output.dmx` loads the native `serialport` binding. If your package manager blocked
> its install scripts, allow them (e.g. `npm install-scripts approve @serialport/bindings-cpp`)
> before enabling DMX output.


## Adding a pattern

1. Create a class under `shared/patterns/` that extends `Pattern`, with a static `Type`
   tag, a static `Fields` schema describing its configurable parameters, and a
   `parameters()` method describing its shape.
2. Register it in the `PATTERNS` array in
   [`shared/patterns/patterns.ts`](shared/patterns/patterns.ts).

The available pattern types and their parameter shapes are derived from that list, so the
UI and shared types pick up the new pattern automatically. `Fields` is the single source
of truth for each parameter's label, default and allowed range: the server validates
incoming props against it and the browser generates the edit form from it.
