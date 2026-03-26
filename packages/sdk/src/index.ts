import {
  BridgeDaemonClient,
  ensureDaemonRunning,
  type ActionResult,
  type LiveBrowserAttachOptions,
  type LocatorSpec,
  type ManagedBrowserLaunchOptions,
  type NetworkSummary,
  type PageLike,
  type PageSummary,
  type SnapshotResult,
} from '@browser-bridge/core';

export interface ConnectOptions {
  autoStart?: boolean;
  defaultBrowserId?: string;
}

export class BrowserBridgeClient {
  private defaultBrowserId: string | undefined;

  public constructor(
    private readonly daemon: BridgeDaemonClient,
    options: ConnectOptions = {},
  ) {
    this.defaultBrowserId = options.defaultBrowserId;
  }

  public async status(): Promise<unknown> {
    return await this.daemon.call('daemon.status');
  }

  public async stopDaemon(): Promise<unknown> {
    return await this.daemon.call('daemon.stop');
  }

  public async browsers(): Promise<unknown> {
    return await this.daemon.call('browsers.list');
  }

  public async attachLive(options: LiveBrowserAttachOptions): Promise<unknown> {
    this.defaultBrowserId ??= options.browserId;
    return await this.daemon.call('browser.attachLive', options);
  }

  public async launchManaged(options: ManagedBrowserLaunchOptions): Promise<unknown> {
    this.defaultBrowserId ??= options.browserId;
    return await this.daemon.call('browser.launchManaged', options);
  }

  public async pages(browserId = this.requireBrowserId()): Promise<PageSummary[]> {
    return await this.daemon.call<PageSummary[]>('pages.list', { browserId });
  }

  public async alias(page: string, alias: string, browserId = this.requireBrowserId()): Promise<PageSummary> {
    return await this.daemon.call<PageSummary>('pages.alias', { browserId, page, alias });
  }

  public async open(url: string, browserId = this.requireBrowserId()): Promise<PageSummary> {
    return await this.daemon.call<PageSummary>('pages.open', { browserId, url });
  }

  public async close(page: string, browserId = this.requireBrowserId()): Promise<ActionResult<string>> {
    return await this.daemon.call<ActionResult<string>>('pages.close', { browserId, page });
  }

  public async warm(pages: string[], browserId = this.requireBrowserId()): Promise<PageSummary[]> {
    return await this.daemon.call<PageSummary[]>('pages.warm', { browserId, pages });
  }

  public page(ref: string, browserId = this.requireBrowserId()): PageLike {
    return new PageHandle(this.daemon, browserId, ref);
  }

  public async disconnect(): Promise<void> {
    await this.daemon.close();
  }

  private requireBrowserId(): string {
    if (!this.defaultBrowserId) {
      throw new Error('No default browserId is set. Attach or launch a browser first, or pass browserId explicitly.');
    }
    return this.defaultBrowserId;
  }
}

class PageHandle implements PageLike {
  public constructor(
    private readonly daemon: BridgeDaemonClient,
    private readonly browserId: string,
    private readonly pageRef: string,
  ) {}

  public async url(): Promise<string> {
    return (await this.snapshot()).url;
  }

  public async title(): Promise<string> {
    return (await this.snapshot()).title;
  }

  public async goto(url: string): Promise<ActionResult<string>> {
    return await this.daemon.call<ActionResult<string>>('page.goto', { browserId: this.browserId, page: this.pageRef, url });
  }

  public async reload(): Promise<ActionResult<string>> {
    return await this.daemon.call<ActionResult<string>>('page.reload', { browserId: this.browserId, page: this.pageRef });
  }

  public locator(locator: LocatorSpec): Promise<string> {
    return Promise.resolve(JSON.stringify(locator));
  }

  public async click(locator: LocatorSpec): Promise<ActionResult> {
    return await this.daemon.call<ActionResult>('page.click', { browserId: this.browserId, page: this.pageRef, locator });
  }

  public async fill(locator: LocatorSpec, value: string): Promise<ActionResult<string>> {
    return await this.daemon.call<ActionResult<string>>('page.fill', { browserId: this.browserId, page: this.pageRef, locator, value });
  }

  public async type(locator: LocatorSpec, value: string): Promise<ActionResult<string>> {
    return await this.daemon.call<ActionResult<string>>('page.type', { browserId: this.browserId, page: this.pageRef, locator, value });
  }

  public async press(key: string): Promise<ActionResult<string>> {
    return await this.daemon.call<ActionResult<string>>('page.press', { browserId: this.browserId, page: this.pageRef, key });
  }

  public async hover(locator: LocatorSpec): Promise<ActionResult> {
    return await this.daemon.call<ActionResult>('page.hover', { browserId: this.browserId, page: this.pageRef, locator });
  }

  public async evaluate<TValue = unknown>(expression: string): Promise<ActionResult<TValue>> {
    return await this.daemon.call<ActionResult<TValue>>('page.evaluate', { browserId: this.browserId, page: this.pageRef, expression });
  }

  public async html(locator?: LocatorSpec): Promise<ActionResult<string>> {
    return await this.daemon.call<ActionResult<string>>('page.html', { browserId: this.browserId, page: this.pageRef, locator });
  }

  public async snapshot(track?: string): Promise<SnapshotResult> {
    return await this.daemon.call<SnapshotResult>('page.snapshot', { browserId: this.browserId, page: this.pageRef, track });
  }

  public async screenshot(filePath?: string): Promise<ActionResult<string>> {
    return await this.daemon.call<ActionResult<string>>('page.screenshot', { browserId: this.browserId, page: this.pageRef, filePath });
  }

  public async waitForSelector(locator: LocatorSpec, hidden?: boolean, timeoutMs?: number): Promise<ActionResult<string>> {
    return await this.daemon.call<ActionResult<string>>('page.wait', {
      browserId: this.browserId,
      page: this.pageRef,
      options: { selector: locator, hidden, timeoutMs },
    });
  }

  public async waitForURL(url: string, timeoutMs?: number): Promise<ActionResult<string>> {
    return await this.daemon.call<ActionResult<string>>('page.wait', {
      browserId: this.browserId,
      page: this.pageRef,
      options: { url, timeoutMs },
    });
  }

  public async waitForText(text: string, timeoutMs?: number): Promise<ActionResult<string>> {
    return await this.daemon.call<ActionResult<string>>('page.wait', {
      browserId: this.browserId,
      page: this.pageRef,
      options: { text, timeoutMs },
    });
  }

  public async waitForIdle(timeoutMs?: number): Promise<ActionResult<string>> {
    return await this.daemon.call<ActionResult<string>>('page.wait', {
      browserId: this.browserId,
      page: this.pageRef,
      options: { idle: true, timeoutMs },
    });
  }

  public async networkSummary(): Promise<NetworkSummary> {
    return await this.daemon.call<NetworkSummary>('page.network', { browserId: this.browserId, page: this.pageRef });
  }

  public async cdp<TValue = unknown>(method: string, params?: Record<string, unknown>): Promise<TValue> {
    return await this.daemon.call<TValue>('page.cdp', { browserId: this.browserId, page: this.pageRef, method, params });
  }
}

export async function connect(options: ConnectOptions = {}): Promise<BrowserBridgeClient> {
  if (options.autoStart !== false) {
    await ensureDaemonRunning();
  }

  const daemon = new BridgeDaemonClient();
  await daemon.connect({ autoStart: options.autoStart });
  return new BrowserBridgeClient(daemon, options);
}
