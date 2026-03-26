import net from 'node:net';
import type { BrowserSessionAdapter } from '../browsers/base.js';
import { LiveBrowserSession } from '../browsers/live.js';
import { ManagedBrowserSession } from '../browsers/managed.js';
import { daemonSocketPath } from '../shared/paths.js';
import type {
  LiveBrowserAttachOptions,
  ManagedBrowserLaunchOptions,
  PageActionParams,
  PageActionWithExpressionParams,
  PageActionWithFileParams,
  PageActionWithLocatorParams,
  RpcEnvelope,
  RpcResponse,
  WaitForOptions,
} from '../shared/types.js';
import { BridgeError } from '../shared/errors.js';
import { decodeRpcBuffer, encodeRpcMessage } from './rpc.js';

export class BridgeDaemonServer {
  private readonly server = net.createServer();
  private readonly browsers = new Map<string, BrowserSessionAdapter>();
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
      const message = error instanceof Error ? error.message : String(error);
      return {
        id: request.id,
        ok: false,
        error: message,
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
      case 'pages.list':
        return await this.withBrowser(params, (browser) => browser.listPages());
      case 'pages.alias':
        return await this.withBrowser(params, (browser, input) => browser.setAlias((input as unknown as { page: string }).page, (input as unknown as { alias: string }).alias));
      case 'pages.open':
        return await this.withBrowser(params, (browser, input) => browser.open((input as unknown as { url?: string }).url));
      case 'pages.close':
        return await this.withBrowser(params, (browser, input) => browser.close((input as unknown as { page: string }).page));
      case 'pages.warm':
        return await this.withBrowser(params, (browser, input) => browser.warm((input as unknown as { pages?: string[] }).pages ?? []));
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
      case 'page.fill':
        return await this.withBrowser(params, (browser, input) => browser.fill((input as unknown as PageActionWithLocatorParams).page, (input as unknown as PageActionWithLocatorParams).locator, (input as unknown as { value: string }).value));
      case 'page.type':
        return await this.withBrowser(params, (browser, input) => browser.type((input as unknown as PageActionWithLocatorParams).page, (input as unknown as PageActionWithLocatorParams).locator, (input as unknown as { value: string }).value));
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
    const browser = await LiveBrowserSession.create(options);
    this.replaceBrowser(browser);
    return browser.summary();
  }

  private async launchManaged(options: ManagedBrowserLaunchOptions): Promise<unknown> {
    const browser = await ManagedBrowserSession.create(options);
    this.replaceBrowser(browser);
    return browser.summary();
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
      throw new BridgeError('BROWSER_NOT_FOUND', `Browser "${browserId}" is not attached.`);
    }

    return await handler(browser, input);
  }
}
