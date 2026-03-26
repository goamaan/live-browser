import { EventEmitter } from 'node:events';
import { BridgeError } from '../shared/errors.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    message: string;
  };
  sessionId?: string;
}

export class CdpClient extends EventEmitter {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly timeoutMs: number;
  private nextId = 0;
  private socket: WebSocket | null = null;
  private wsUrl: string | null = null;

  public constructor(timeoutMs = 15_000) {
    super();
    this.timeoutMs = timeoutMs;
  }

  public async connect(wsUrl: string): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    this.wsUrl = wsUrl;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      this.socket = socket;

      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener(
        'error',
        (event) => {
          reject(new BridgeError('CDP_CONNECT_FAILED', `Failed to connect to ${wsUrl}: ${String(event.type)}`));
        },
        { once: true },
      );
      socket.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });
      socket.addEventListener('close', () => {
        this.emit('close');
        for (const [id, pending] of this.pending.entries()) {
          clearTimeout(pending.timer);
          pending.reject(new BridgeError('CDP_CLOSED', `CDP socket closed before request ${id} completed.`));
        }
        this.pending.clear();
      });
    });
  }

  public async reconnect(): Promise<void> {
    if (!this.wsUrl) {
      throw new BridgeError('CDP_NO_ENDPOINT', 'Cannot reconnect before an initial connect call.');
    }

    await this.close();
    await this.connect(this.wsUrl);
  }

  public async close(): Promise<void> {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;

    await new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }

      socket.addEventListener('close', () => resolve(), { once: true });
      socket.close();
    });
  }

  public async send<TResult = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = this.timeoutMs,
  ): Promise<TResult> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new BridgeError('CDP_NOT_CONNECTED', 'CDP socket is not connected.');
    }

    const id = ++this.nextId;
    const message: Record<string, unknown> = {
      id,
      method,
      params,
    };

    if (sessionId) {
      message.sessionId = sessionId;
    }

    return await new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError('CDP_TIMEOUT', `Timed out waiting for ${method}.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timer,
      });

      this.socket?.send(JSON.stringify(message));
    });
  }

  public onEvent<TParams = unknown>(
    method: string,
    handler: (params: TParams, envelope: { sessionId?: string }) => void,
    sessionId?: string,
  ): () => void {
    const key = this.eventKey(method, sessionId);
    this.on(key, handler as (...args: unknown[]) => void);
    return () => this.off(key, handler as (...args: unknown[]) => void);
  }

  public async waitForEvent<TParams = unknown>(
    method: string,
    options: {
      sessionId?: string;
      timeoutMs?: number;
      predicate?: (params: TParams) => boolean;
    } = {},
  ): Promise<TParams> {
    return await new Promise<TParams>((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        reject(new BridgeError('CDP_EVENT_TIMEOUT', `Timed out waiting for ${method}.`));
      }, options.timeoutMs ?? this.timeoutMs);

      const off = this.onEvent<TParams>(
        method,
        (params) => {
          if (options.predicate && !options.predicate(params)) {
            return;
          }

          clearTimeout(timeout);
          off();
          resolve(params);
        },
        options.sessionId,
      );
    });
  }

  private handleMessage(raw: unknown): void {
    const payload = typeof raw === 'string' ? raw : raw instanceof Buffer ? raw.toString('utf8') : String(raw);
    const message = JSON.parse(payload) as CdpMessage;

    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timer);
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new BridgeError('CDP_ERROR', message.error.message));
        return;
      }

      pending.resolve(message.result);
      return;
    }

    if (!message.method) {
      return;
    }

    this.emit(this.eventKey(message.method), message.params, { sessionId: message.sessionId });
    if (message.sessionId) {
      this.emit(this.eventKey(message.method, message.sessionId), message.params, { sessionId: message.sessionId });
    }
  }

  private eventKey(method: string, sessionId?: string): string {
    return sessionId ? `${sessionId}:${method}` : `global:${method}`;
  }
}
