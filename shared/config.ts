// The settings in config.json, as the config page sees them. The edit password is part
// of the file but never leaves the server, so it is not in here: the page only learns
// whether one is set, and sends a replacement when the user types a new one.

export interface ArtNetSettings {
  enabled: boolean;
  host: string;
  port: number;
  net: number;
  subnet: number;
  universe: number;
  startChannel: number;
  // 0 means "as many channels as the frame needs".
  endChannel: number;
  universeSize: number;
  refreshRate: number;
}

export interface OutputSettings {
  rotation: number;
  // `{ "5": 3 }` sends the color computed for light 5 to light 3. Has to be a closed
  // shuffle: every light that gives its color away must be given one back.
  remap: Record<string, number>;
  artnet: ArtNetSettings;
}

export interface ServerSettings {
  tickRate: number;
  port: number;
  scenes: string;
  blackoutTransition: number;
  halfLightTransition: number;
  halfLightFeather: number;
  solidColorTransition: number;
  sceneTransition: number;
}

export interface Settings {
  nLights: number;
  server: ServerSettings;
  output: OutputSettings;
}

// What GET /api/config answers with.
export interface ConfigStatus {
  settings: Settings;
  // Whether server.editPassword is non-empty. The password itself is never sent.
  editPasswordSet: boolean;
}

// What PUT /api/config accepts. Leaving `editPassword` out keeps the current one; an
// empty string clears it and opens the editor up to everyone.
export interface ConfigUpdate {
  settings: Settings;
  editPassword?: string;
}

// What PUT /api/config answers with: the saved settings, plus the paths of the ones that
// were changed but are only read while the server starts up, so the page can say which
// of them are waiting for a restart.
export interface ConfigSaved extends ConfigStatus {
  restartRequired: string[];
}

// Settings the running process only reads at startup. A save writes them to config.json
// but they take effect on the next restart; `nLights` reaches the browser at build time
// as well, so changing it needs a rebuild too.
export const RESTART_REQUIRED_SETTINGS = [
  'nLights',
  'server.tickRate',
  'server.port',
  'server.scenes',
  'output.rotation',
  'output.remap',
  'output.artnet'
];
