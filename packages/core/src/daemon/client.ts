import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { daemonSocketPath } from '../shared/paths.js';
import type { RpcEnvelope, RpcResponse } from '../shared/types.js';
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

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath, () => resolve());
      this.socket = socket;
      socket.on('data', (chunk) => this.handleChunk(chunk.toString('utf8')));
      socket.on('error', (error) => reject(error));
      socket.on('close', () => {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new BridgeError('DAEMON_DISCONNECTED', 'Daemon connection closed.'));
        }
        this.pending.clear();
      });
    }).catch((error) => {
      throw new BridgeError('DAEMON_CONNECT_FAILED', `Failed to connect to daemon: ${String(error)}`);
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
    if (!this.socket || this.socket.destroyed) {
      await this.connect();
    }

    const id = `${Date.now()}-${++this.nextId}`;
    const envelope: RpcEnvelope = { id, method, params };
    return await new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError('DAEMON_TIMEOUT', `Timed out waiting for daemon response to ${method}.`));
      }, 20_000);

      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timer,
      });
      this.socket?.write(encodeRpcMessage(envelope));
    });
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
        pending.reject(new BridgeError('DAEMON_ERROR', response.error ?? 'Unknown daemon error.'));
        continue;
      }

      pending.resolve(response.result);
    }
  }
}

export async function ensureDaemonRunning(): Promise<void> {
  const path = daemonSocketPath();
  const exists = await canConnect(path);
  if (exists) {
    return;
  }

  const daemonEntry = fileURLToPath(new URL('../bin/bridge-daemon.js', import.meta.url));
  const child = spawn(process.execPath, [daemonEntry], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

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
