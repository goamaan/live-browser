import net from 'node:net';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { daemonSocketPath } from '../shared/paths.js';
import type { BridgeFault, RpcEnvelope, RpcResponse } from '../shared/types.js';
import { BridgeError } from '../shared/errors.js';
import { decodeRpcBuffer, encodeRpcMessage } from './rpc.js';

interface PendingResponse {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

export interface BridgeDaemonClientOptions {
  autoStart?: boolean;
}

export class BridgeDaemonClient {
  private readonly socketPath = daemonSocketPath();
  private readonly pending = new Map<string, PendingResponse>();
  private socket: net.Socket | null = null;
  private buffer = '';
  private nextId = 0;

  public async connect(options: BridgeDaemonClientOptions = {}): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      return;
    }

    if (options.autoStart !== false) {
      await ensureDaemonRunning();
    }

    await this.connectSocketWithRetries(options.autoStart !== false ? 10_000 : 2_000).catch((error) => {
      throw new BridgeError('DAEMON_CONNECT_FAILED', `Failed to connect to daemon: ${String(error)}`, {
        retryable: true,
        recoverable: true,
      });
    });
  }

  public async close(): Promise<void> {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.end();
    });
  }

  public async call<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
    return await this.callInternal(method, params, isRetryableMethod(method), methodTimeoutMs(method));
  }

  private async callInternal<TResult = unknown>(
    method: string,
    params: unknown,
    allowRetry: boolean,
    timeoutMs: number,
  ): Promise<TResult> {
    if (!this.socket || this.socket.destroyed) {
      await this.connect();
    }

    const id = `${Date.now()}-${++this.nextId}`;
    const envelope: RpcEnvelope = { id, method, params };

    try {
      return await new Promise<TResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(
            new BridgeError('DAEMON_TIMEOUT', `Timed out waiting for daemon response to ${method}.`, {
              retryable: true,
              recoverable: true,
            }),
          );
        }, timeoutMs);

        this.pending.set(id, {
          resolve: (value) => resolve(value as TResult),
          reject,
          timer,
        });
        this.socket?.write(encodeRpcMessage(envelope));
      });
    } catch (error) {
      const bridgeError = error instanceof BridgeError ? error : new BridgeError('DAEMON_ERROR', String(error));
      if (!allowRetry || !isRetryableFault(bridgeError)) {
        throw bridgeError;
      }

      await this.close().catch(() => undefined);
      await this.connect();
      return await this.callInternal<TResult>(method, params, false, timeoutMs);
    }
  }

  private handleChunk(chunk: string): void {
    this.buffer += chunk;
    const parsed = decodeRpcBuffer(this.buffer);
    this.buffer = parsed.remainder;
    for (const message of parsed.messages) {
      const response = message as RpcResponse;
      const pending = this.pending.get(response.id);
      if (!pending) {
        continue;
      }

      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (!response.ok) {
        const error = response.error ? BridgeError.fromFault(response.error) : new BridgeError('DAEMON_ERROR', 'Unknown daemon error.');
        pending.reject(error);
        continue;
      }

      pending.resolve(response.result);
    }
  }

  private async connectSocketWithRetries(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        await this.connectSocketOnce();
        return;
      } catch (error) {
        lastError = error;
        this.socket = null;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error(lastError === undefined ? 'Timed out connecting to the daemon socket.' : 'Timed out connecting to the daemon socket with a non-error failure value.');
  }

  private async connectSocketOnce(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath, () => resolve());
      this.socket = socket;
      socket.on('data', (chunk) => this.handleChunk(chunk.toString('utf8')));
      socket.on('error', (error) => {
        socket.destroy();
        reject(error);
      });
      socket.on('close', () => {
        this.socket = null;
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(
            new BridgeError('DAEMON_DISCONNECTED', 'Daemon connection closed.', {
              retryable: true,
              recoverable: true,
              hint: 'Reconnect to the daemon and retry safe read-only operations.',
            }),
          );
        }
        this.pending.clear();
      });
    });
  }
}

export async function ensureDaemonRunning(): Promise<void> {
  const path = daemonSocketPath();
  const exists = await canConnect(path);
  if (exists) {
    return;
  }

  const daemonEntry = resolveDaemonEntry();
  startDetachedDaemon(resolveDaemonRuntime(), daemonEntry, path);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await canConnect(path)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new BridgeError('DAEMON_START_FAILED', 'Timed out waiting for the background daemon to start.');
}

async function canConnect(path: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection(path, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

function isRetryableMethod(method: string): boolean {
  return new Set([
    'daemon.status',
    'browsers.list',
    'pages.list',
    'pages.resolve',
    'pages.warm',
    'browser.doctor',
    'page.snapshot',
    'page.screenshot',
    'page.html',
    'page.evaluate',
    'page.wait',
    'page.network',
  ]).has(method);
}

function methodTimeoutMs(method: string): number {
  if (method === 'browser.attachLive') {
    return 120_000;
  }

  if (method === 'browser.launchManaged') {
    return 120_000;
  }

  return 20_000;
}

function isRetryableFault(error: BridgeError | BridgeFault): boolean {
  return (
    (error.code === 'DAEMON_DISCONNECTED' ||
      error.code === 'DAEMON_CONNECT_FAILED' ||
      error.code === 'DAEMON_TIMEOUT' ||
      error.code === 'BROWSER_NOT_FOUND') &&
    error.recoverable
  );
}

function resolveDaemonRuntime(): string {
  const preferred = [process.env.BROWSER_BRIDGE_NODE_PATH, process.env.npm_node_execpath]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .find((value) => isNodeExecutable(value));

  if (preferred) {
    return preferred;
  }

  if (!process.versions.bun && isNodeExecutable(process.execPath)) {
    return process.execPath;
  }

  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = execFileSync(command, ['node'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return result ?? process.execPath;
}

function isNodeExecutable(path: string): boolean {
  return /(^|[\\/])node(?:\.exe)?$/i.test(path);
}

function resolveDaemonEntry(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(currentFile), '..', '..');
  const compiledEntry = path.join(packageRoot, 'dist', 'bin', 'live-browser-daemon.js');

  if (!existsSync(compiledEntry)) {
    throw new BridgeError('DAEMON_ENTRY_MISSING', `Expected a built daemon entry at ${compiledEntry}.`, {
      recoverable: true,
      hint: 'Build live-browser before using the workspace CLI checkout.',
      suggestedNextSteps: ['Run bun run build from the repository root.'],
      diagnostics: {
        packageRoot,
        currentFile,
      },
    });
  }

  return compiledEntry;
}

function startDetachedDaemon(runtime: string, daemonEntry: string, socketPath: string): void {
  if (process.versions.bun) {
    execFileSync(
      runtime,
      ['-e', daemonBootstrapSource, runtime, daemonEntry, socketPath],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    return;
  }

  const child = spawn(runtime, [daemonEntry], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

const daemonBootstrapSource = `
const { spawn } = require('node:child_process');
const net = require('node:net');

const [runtime, daemonEntry, socketPath] = process.argv.slice(1);
const child = spawn(runtime, [daemonEntry], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});
child.unref();

const deadline = Date.now() + 10_000;
const probe = () => {
  const socket = net.createConnection(socketPath, () => {
    socket.destroy();
    process.exit(0);
  });
  socket.once('error', () => {
    socket.destroy();
    if (Date.now() >= deadline) {
      process.exit(1);
      return;
    }
    setTimeout(probe, 200);
  });
};

probe();
`;
