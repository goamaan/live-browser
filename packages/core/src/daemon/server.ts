import net from 'node:net';
import type { BrowserSessionAdapter } from '../browsers/base.js';
import { LiveBrowserSession } from '../browsers/live.js';
import { ManagedBrowserSession } from '../browsers/managed.js';
import { daemonSocketPath } from '../shared/paths.js';
import { readBrowserState } from '../shared/state.js';
import type {
  LiveBrowserAttachOptions,
  ManagedBrowserLaunchOptions,
  PageActionParams,
  PageActionWithExpressionParams,
  PageActionWithFileParams,
  PageActionWithLocatorParams,
  PageActionWithPointParams,
  RpcEnvelope,
  RpcResponse,
  WaitForOptions,
} from '../shared/types.js';
import { BridgeError, toBridgeFault } from '../shared/errors.js';
import { decodeRpcBuffer, encodeRpcMessage } from './rpc.js';

const LIVE_ATTACH_COOLDOWN_MS = 30_000;

export class BridgeDaemonServer {
  private readonly server = net.createServer();
  private readonly browsers = new Map<string, BrowserSessionAdapter>();
  private readonly browserPreparations = new Map<string, Promise<BrowserSessionAdapter>>();
  private readonly liveAttachFailures = new Map<string, { at: number; error: BridgeError }>();
  private readonly socketPath = daemonSocketPath();
  private stopping = false;

  public async start(): Promise<void> {
    this.server.on('connection', (socket) => {
      let buffer = '';

      socket.on('data', (chunk) => {
        void (async () => {
          buffer += chunk.toString('utf8');
          const parsed = decodeRpcBuffer(buffer);
          buffer = parsed.remainder;

          for (const message of parsed.messages) {
            const request = message as RpcEnvelope;
            const response = await this.handleRequest(request);
            socket.write(encodeRpcMessage(response));
          }
        })();
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.socketPath, () => resolve());
    });
  }

  public async stop(): Promise<void> {
    if (this.stopping) {
      return;
    }

    this.stopping = true;
    for (const browser of this.browsers.values()) {
      await browser.dispose();
    }
    this.browsers.clear();

    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private async handleRequest(request: RpcEnvelope): Promise<RpcResponse> {
    try {
      const result = await this.route(request.method, request.params);
      return {
        id: request.id,
        ok: true,
        result,
      };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        error: toBridgeFault(error),
      };
    }
  }

  private async route(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'daemon.status':
        return {
          socketPath: this.socketPath,
          browsers: [...this.browsers.values()].map((browser) => browser.summary()),
        };
      case 'daemon.stop':
        setTimeout(() => {
          void this.stop();
        }, 50);
        return { stopping: true };
      case 'browsers.list':
        return [...this.browsers.values()].map((browser) => browser.summary());
      case 'browser.attachLive':
        return await this.attachLive(params as LiveBrowserAttachOptions);
      case 'browser.launchManaged':
        return await this.launchManaged(params as ManagedBrowserLaunchOptions);
      case 'browser.detach':
        return await this.detachBrowser(params);
      case 'pages.list':
        return await this.withBrowser(params, (browser) => browser.listPages());
      case 'pages.resolve':
        return await this.withBrowser(params, (browser, input) => browser.resolvePage((input as unknown as { page: string }).page));
      case 'pages.alias':
        return await this.withBrowser(params, (browser, input) => browser.setAlias((input as unknown as { page: string }).page, (input as unknown as { alias: string }).alias));
      case 'pages.open':
        return await this.withBrowser(params, (browser, input) => browser.open((input as unknown as { url?: string }).url));
      case 'pages.close':
        return await this.withBrowser(params, (browser, input) => browser.close((input as unknown as { page: string }).page));
      case 'pages.warm':
        return await this.withBrowser(params, (browser, input) => browser.warm((input as unknown as { pages?: string[] }).pages ?? []));
      case 'browser.doctor':
        return await this.withBrowser(params, (browser, input) => browser.doctor((input as unknown as { page?: string }).page));
      case 'page.snapshot':
        return await this.withBrowser(params, (browser, input) => browser.snapshot((input as unknown as PageActionParams).page, (input as unknown as { track?: string }).track));
      case 'page.screenshot':
        return await this.withBrowser(params, (browser, input) => browser.screenshot((input as unknown as PageActionWithFileParams).page, (input as unknown as PageActionWithFileParams).filePath));
      case 'page.html':
        return await this.withBrowser(params, (browser, input) => browser.html((input as unknown as PageActionParams).page, (input as unknown as { locator?: unknown }).locator as never));
      case 'page.evaluate':
        return await this.withBrowser(params, (browser, input) => browser.evaluate((input as unknown as PageActionWithExpressionParams).page, (input as unknown as PageActionWithExpressionParams).expression));
      case 'page.click':
        return await this.withBrowser(params, (browser, input) => browser.click((input as unknown as PageActionWithLocatorParams).page, (input as unknown as PageActionWithLocatorParams).locator));
      case 'page.clickPoint':
        return await this.withBrowser(
          params,
          (browser, input) =>
            browser.clickPoint(
              (input as unknown as PageActionWithPointParams).page,
              Number((input as unknown as PageActionWithPointParams).x),
              Number((input as unknown as PageActionWithPointParams).y),
            ),
        );
      case 'page.fill':
        return await this.withBrowser(params, (browser, input) => browser.fill((input as unknown as PageActionWithLocatorParams).page, (input as unknown as PageActionWithLocatorParams).locator, (input as unknown as { value: string }).value));
      case 'page.type':
        return await this.withBrowser(params, (browser, input) => browser.type((input as unknown as PageActionWithLocatorParams).page, (input as unknown as PageActionWithLocatorParams).locator, (input as unknown as { value: string }).value));
      case 'page.insertText':
        return await this.withBrowser(params, (browser, input) => browser.insertText((input as unknown as PageActionParams).page, (input as unknown as { value: string }).value));
      case 'page.loadAll':
        return await this.withBrowser(
          params,
          (browser, input) =>
            browser.loadAll(
              (input as unknown as PageActionWithLocatorParams).page,
              (input as unknown as PageActionWithLocatorParams).locator,
              Number((input as unknown as { intervalMs?: number }).intervalMs ?? 250),
            ),
        );
      case 'page.press':
        return await this.withBrowser(params, (browser, input) => browser.press((input as unknown as PageActionParams).page, (input as unknown as { key: string }).key));
      case 'page.hover':
        return await this.withBrowser(params, (browser, input) => browser.hover((input as unknown as PageActionWithLocatorParams).page, (input as unknown as PageActionWithLocatorParams).locator));
      case 'page.wait':
        return await this.withBrowser(params, (browser, input) => browser.wait((input as unknown as PageActionParams).page, (input as unknown as { options: WaitForOptions }).options));
      case 'page.network':
        return await this.withBrowser(params, (browser, input) => browser.networkSummary((input as unknown as PageActionParams).page));
      case 'page.cdp':
        return await this.withBrowser(params, (browser, input) => browser.cdp((input as unknown as PageActionParams).page, (input as unknown as { method: string }).method, (input as unknown as { params?: Record<string, unknown> }).params));
      case 'page.goto':
        return await this.withBrowser(params, (browser, input) => browser.goto((input as unknown as PageActionParams).page, (input as unknown as { url: string }).url));
      case 'page.reload':
        return await this.withBrowser(params, (browser, input) => browser.reload((input as unknown as PageActionParams).page));
      default:
        throw new BridgeError('UNKNOWN_METHOD', `Unknown daemon method: ${method}`);
    }
  }

  private async attachLive(options: LiveBrowserAttachOptions): Promise<unknown> {
    const existing = this.browsers.get(options.browserId);
    if (existing && existing.mode === 'live' && existing.summary().connected) {
      return existing.summary();
    }

    const browser = await this.prepareBrowser(options.browserId, async () => await LiveBrowserSession.create(options), true);
    return browser.summary();
  }

  private async launchManaged(options: ManagedBrowserLaunchOptions): Promise<unknown> {
    const browser = await this.prepareBrowser(options.browserId, async () => await ManagedBrowserSession.create(options), false);
    return browser.summary();
  }

  private async detachBrowser(params: unknown): Promise<unknown> {
    const input = (params ?? {}) as Record<string, unknown>;
    const browserId = input.browserId;
    if (typeof browserId !== 'string' || browserId.length === 0) {
      throw new BridgeError('BROWSER_REQUIRED', 'browserId is required for this command.');
    }

    const browser = this.browsers.get(browserId);
    if (!browser) {
      throw new BridgeError('BROWSER_NOT_FOUND', `Browser "${browserId}" is not attached.`, {
        retryable: true,
        recoverable: true,
      });
    }

    this.browsers.delete(browserId);
    return await browser.detach();
  }

  private replaceBrowser(browser: BrowserSessionAdapter): void {
    const existing = this.browsers.get(browser.id);
    if (existing) {
      void existing.dispose();
    }
    this.browsers.set(browser.id, browser);
  }

  private async withBrowser(
    params: unknown,
    handler: (browser: BrowserSessionAdapter, params: Record<string, unknown>) => Promise<unknown>,
  ): Promise<unknown> {
    const input = (params ?? {}) as Record<string, unknown>;
    const browserId = input.browserId;
    if (typeof browserId !== 'string' || browserId.length === 0) {
      throw new BridgeError('BROWSER_REQUIRED', 'browserId is required for this command.');
    }

    const browser = this.browsers.get(browserId);
    if (!browser) {
      this.throwIfLiveAttachCoolingDown(browserId);
      const restored = await this.tryRestoreBrowser(browserId);
      if (!restored) {
        throw new BridgeError('BROWSER_NOT_FOUND', `Browser "${browserId}" is not attached.`, {
          retryable: true,
          recoverable: true,
          hint: 'Attach the browser again, or keep the persisted live-browser state file so the daemon can restore it.',
          diagnostics: { browserId },
          suggestedNextSteps: [
            `Run live-browser browsers attach --browser-id ${browserId}`,
            `Run live-browser doctor --browser ${browserId}`,
          ],
        });
      }
    }

    return await handler(this.browsers.get(browserId) as BrowserSessionAdapter, input);
  }

  private async tryRestoreBrowser(browserId: string): Promise<boolean> {
    const state = await readBrowserState(browserId);
    if (!state) {
      return false;
    }

    if (state.mode !== 'live') {
      return false;
    }

    const browser = await this.prepareBrowser(browserId, async () => await LiveBrowserSession.restore(state), true);
    this.browsers.set(browserId, browser);
    return true;
  }

  private async prepareBrowser(
    browserId: string,
    create: () => Promise<BrowserSessionAdapter>,
    applyLiveCooldown: boolean,
  ): Promise<BrowserSessionAdapter> {
    if (applyLiveCooldown) {
      this.throwIfLiveAttachCoolingDown(browserId);
    }

    const existing = this.browserPreparations.get(browserId);
    if (existing) {
      return await existing;
    }

    const preparation = create()
      .then((browser) => {
        this.replaceBrowser(browser);
        this.liveAttachFailures.delete(browserId);
        return browser;
      })
      .catch((error) => {
        const bridgeError = error instanceof BridgeError ? error : BridgeError.fromFault(toBridgeFault(error));
        if (applyLiveCooldown) {
          this.liveAttachFailures.set(browserId, {
            at: Date.now(),
            error: bridgeError,
          });
        }
        throw bridgeError;
      })
      .finally(() => {
        this.browserPreparations.delete(browserId);
      });

    this.browserPreparations.set(browserId, preparation);
    return await preparation;
  }

  private throwIfLiveAttachCoolingDown(browserId: string): void {
    const failure = this.liveAttachFailures.get(browserId);
    if (!failure) {
      return;
    }

    const elapsedMs = Date.now() - failure.at;
    if (elapsedMs >= LIVE_ATTACH_COOLDOWN_MS) {
      this.liveAttachFailures.delete(browserId);
      return;
    }

    throw new BridgeError('LIVE_ATTACH_COOLDOWN', `Live attach for "${browserId}" is cooling down after a failed approval handshake.`, {
      retryable: true,
      recoverable: true,
      hint: 'Wait briefly before retrying so Chrome does not show repeated approval prompts.',
      diagnostics: {
        browserId,
        retryAfterMs: LIVE_ATTACH_COOLDOWN_MS - elapsedMs,
        previousError: failure.error.toFault(),
      },
      suggestedNextSteps: [
        'Bring Chrome to the foreground and dismiss any existing remote debugging prompt once.',
        `Retry live-browser browsers attach --browser-id ${browserId} after the cooldown expires.`,
      ],
    });
  }
}
