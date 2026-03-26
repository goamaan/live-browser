import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BridgeError } from '../shared/errors.js';
import type { LiveBrowserAttachOptions } from '../shared/types.js';
import { resolveHttpDebuggerUrl } from './protocol.js';

export interface LiveEndpointResolution {
  wsEndpoint: string;
  source: string;
  portFile?: string;
}

function parsePortFile(filePath: string, host: string): LiveEndpointResolution {
  const raw = readFileSync(filePath, 'utf8').trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const [port, wsPath] = raw;
  if (!port || !wsPath?.startsWith('/devtools/browser/')) {
    throw new BridgeError('INVALID_PORT_FILE', `Invalid DevToolsActivePort file: ${filePath}`);
  }

  return {
    wsEndpoint: `ws://${host}:${port}${wsPath}`,
    source: 'devtools-active-port',
    portFile: filePath,
  };
}

function standardPortFiles(): string[] {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');

  if (process.platform === 'win32') {
    const bases = [
      ['Google', 'Chrome'],
      ['Google', 'Chrome Beta'],
      ['Google', 'Chrome SxS'],
      ['BraveSoftware', 'Brave-Browser'],
      ['Microsoft', 'Edge'],
      ['Chromium'],
      ['Vivaldi'],
    ];

    return bases.flatMap((parts) => {
      const root = path.join(localAppData, ...parts, 'User Data');
      return [path.join(root, 'DevToolsActivePort'), path.join(root, 'Default', 'DevToolsActivePort')];
    });
  }

  if (process.platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    const names = [
      ['Google', 'Chrome'],
      ['Google', 'Chrome Beta'],
      ['Google', 'Chrome for Testing'],
      ['BraveSoftware', 'Brave-Browser'],
      ['Microsoft Edge'],
      ['Chromium'],
      ['Vivaldi'],
    ];

    return names.flatMap((parts) => {
      const root = path.join(base, ...parts);
      return [path.join(root, 'DevToolsActivePort'), path.join(root, 'Default', 'DevToolsActivePort')];
    });
  }

  const configBase = path.join(home, '.config');
  const names = [
    'google-chrome',
    'google-chrome-beta',
    'chromium',
    'BraveSoftware/Brave-Browser',
    'microsoft-edge',
    'vivaldi',
  ];
  return names.flatMap((name) => [
    path.join(configBase, name, 'DevToolsActivePort'),
    path.join(configBase, name, 'Default', 'DevToolsActivePort'),
  ]);
}

export async function resolveLiveBrowserEndpoint(options: LiveBrowserAttachOptions): Promise<LiveEndpointResolution> {
  const host = options.host ?? '127.0.0.1';

  if (options.wsEndpoint) {
    return {
      wsEndpoint: options.wsEndpoint,
      source: 'explicit-ws',
    };
  }

  if (options.httpEndpoint) {
    const wsEndpoint = await resolveHttpDebuggerUrl(options.httpEndpoint);
    if (wsEndpoint) {
      return {
        wsEndpoint,
        source: 'explicit-http',
      };
    }
  }

  if (options.devToolsActivePortFile) {
    if (!existsSync(options.devToolsActivePortFile)) {
      throw new BridgeError('PORT_FILE_MISSING', `Port file not found: ${options.devToolsActivePortFile}`);
    }

    return parsePortFile(options.devToolsActivePortFile, host);
  }

  const candidate = standardPortFiles().find((filePath) => existsSync(filePath));
  if (!candidate) {
    throw new BridgeError(
      'LIVE_BROWSER_NOT_FOUND',
      'No DevToolsActivePort file found. Enable Chrome remote debugging or pass an explicit endpoint.',
    );
  }

  return parsePortFile(candidate, host);
}

