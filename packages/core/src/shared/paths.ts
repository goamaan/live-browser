import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

function runtimeBaseDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'browser-bridge');
  }

  if (process.env.XDG_RUNTIME_DIR) {
    return path.join(process.env.XDG_RUNTIME_DIR, 'browser-bridge');
  }

  return path.join(os.homedir(), '.cache', 'browser-bridge');
}

export function ensureRuntimeDir(): string {
  const dir = runtimeBaseDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function daemonSocketPath(): string {
  const dir = ensureRuntimeDir();
  if (process.platform === 'win32') {
    const user = (process.env.USERNAME ?? process.env.USER ?? 'user').replace(/[^A-Za-z0-9._-]/g, '-').toLowerCase();
    return `\\\\.\\pipe\\browser-bridge-${user}`;
  }

  return path.join(dir, 'daemon.sock');
}

export function screenshotsDir(): string {
  const dir = path.join(ensureRuntimeDir(), 'screenshots');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function defaultScreenshotPath(browserId: string, targetId: string): string {
  const safeBrowser = browserId.replace(/[^A-Za-z0-9._-]/g, '-');
  const safeTarget = targetId.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 16);
  return path.join(screenshotsDir(), `${safeBrowser}-${safeTarget}.png`);
}

