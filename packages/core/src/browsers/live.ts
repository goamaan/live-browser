import { CdpClient } from '../cdp/client.js';
import { resolveLiveBrowserEndpoint } from '../cdp/discovery.js';
import {
  captureHtml,
  captureScreenshot,
  captureSnapshot,
  clickElement,
  evaluateInPage,
  fillElement,
  hoverElement,
  pressKey,
  typeIntoElement,
  waitForCondition,
} from '../actions/dom.js';
import type {
  ActionResult,
  BrowserSummary,
  LiveBrowserAttachOptions,
  LocatorSpec,
  NetworkRequestSummary,
  NetworkSummary,
  PageSummary,
  SnapshotResult,
  WaitForOptions,
} from '../shared/types.js';
import { BridgeError, ensure } from '../shared/errors.js';
import type { BrowserSessionAdapter } from './base.js';

interface TargetInfo {
  targetId: string;
  title: string;
  url: string;
  type: string;
}

interface SessionNetworkState {
  requests: Map<string, NetworkRequestSummary>;
  inflight: Set<string>;
}

interface SessionState {
  sessionId: string;
  targetId: string;
  network: SessionNetworkState;
  disposers: Array<() => void>;
}

export class LiveBrowserSession implements BrowserSessionAdapter {
  public readonly mode = 'live' as const;

  private readonly attachedAt = new Date().toISOString();
  private readonly label: string;
  private readonly source: string;
  private readonly endpoint: string;
  private readonly client: CdpClient;
  private readonly targets = new Map<string, TargetInfo & { lastSeenAt: string }>();
  private readonly aliases = new Map<string, string>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly snapshotTracks = new Map<string, SnapshotResult['nodes']>();

  public constructor(
    public readonly id: string,
    label: string,
    source: string,
    endpoint: string,
    client: CdpClient,
  ) {
    this.label = label;
    this.source = source;
    this.endpoint = endpoint;
    this.client = client;
  }

  public static async create(options: LiveBrowserAttachOptions): Promise<LiveBrowserSession> {
    const resolution = await resolveLiveBrowserEndpoint(options);
    const client = new CdpClient();
    await client.connect(resolution.wsEndpoint);

    const session = new LiveBrowserSession(
      options.browserId,
      options.label ?? options.browserId,
      resolution.source,
      resolution.wsEndpoint,
      client,
    );

    await session.bootstrap();
    return session;
  }

  public summary(): BrowserSummary {
    return {
      id: this.id,
      mode: this.mode,
      label: this.label,
      connected: true,
      source: this.source,
      endpoint: this.endpoint,
      attachedAt: this.attachedAt,
    };
  }

  public async listPages(): Promise<PageSummary[]> {
    await this.refreshTargets();
    return [...this.targets.values()]
      .sort((left, right) => left.title.localeCompare(right.title))
      .map((target) => this.toPageSummary(target.targetId));
  }

  public async setAlias(pageRef: string, alias: string): Promise<PageSummary> {
    const targetId = await this.resolveTargetId(pageRef);
    this.aliases.set(alias, targetId);
    return this.toPageSummary(targetId);
  }

  public async open(url = 'about:blank'): Promise<PageSummary> {
    const result = await this.client.send<{ targetId: string }>('Target.createTarget', { url });
    await this.refreshTargets();
    return this.toPageSummary(result.targetId);
  }

  public async close(pageRef: string): Promise<ActionResult<string>> {
    const targetId = await this.resolveTargetId(pageRef);
    await this.client.send('Target.closeTarget', { targetId });
    this.targets.delete(targetId);

    return {
      ok: true,
      page: {
        browserId: this.id,
        targetId,
        alias: this.findAlias(targetId),
        title: '',
        url: '',
        mode: this.mode,
        attached: false,
        lastSeenAt: new Date().toISOString(),
      },
      url: '',
      title: '',
      value: targetId,
    };
  }

  public async warm(pageRefs: string[]): Promise<PageSummary[]> {
    const refs = pageRefs.length > 0 ? pageRefs : (await this.listPages()).map((page) => page.targetId);
    const pages: PageSummary[] = [];
    for (const ref of refs) {
      const targetId = await this.resolveTargetId(ref);
      await this.attachSession(targetId);
      pages.push(this.toPageSummary(targetId));
    }
    return pages;
  }

  public async snapshot(pageRef: string, track?: string): Promise<SnapshotResult> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    const page = this.toPageSummary(targetId);
    const trackKey = track ? `${targetId}:${track}` : undefined;
    const previous = trackKey ? this.snapshotTracks.get(trackKey) : undefined;
    const snapshot = await captureSnapshot(this.client, sessionId, page, previous);
    if (trackKey) {
      this.snapshotTracks.set(trackKey, snapshot.nodes);
    }
    return snapshot;
  }

  public async screenshot(pageRef: string, filePath?: string): Promise<ActionResult<string>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await captureScreenshot(this.client, sessionId, this.toPageSummary(targetId), filePath);
  }

  public async html(pageRef: string, locator?: LocatorSpec): Promise<ActionResult<string>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await captureHtml(this.client, sessionId, this.toPageSummary(targetId), locator);
  }

  public async evaluate<TValue = unknown>(pageRef: string, expression: string): Promise<ActionResult<TValue>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await evaluateInPage<TValue>(this.client, sessionId, this.toPageSummary(targetId), expression);
  }

  public async click(pageRef: string, locator: LocatorSpec): Promise<ActionResult> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await clickElement(this.client, sessionId, this.toPageSummary(targetId), locator);
  }

  public async fill(pageRef: string, locator: LocatorSpec, value: string): Promise<ActionResult<string>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await fillElement(this.client, sessionId, this.toPageSummary(targetId), locator, value);
  }

  public async type(pageRef: string, locator: LocatorSpec, value: string): Promise<ActionResult<string>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await typeIntoElement(this.client, sessionId, this.toPageSummary(targetId), locator, value);
  }

  public async press(pageRef: string, key: string): Promise<ActionResult<string>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await pressKey(this.client, sessionId, this.toPageSummary(targetId), key);
  }

  public async hover(pageRef: string, locator: LocatorSpec): Promise<ActionResult> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await hoverElement(this.client, sessionId, this.toPageSummary(targetId), locator);
  }

  public async wait(pageRef: string, options: WaitForOptions): Promise<ActionResult<string>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await waitForCondition(this.client, sessionId, this.toPageSummary(targetId), () => this.networkSnapshot(targetId), options);
  }

  public async networkSummary(pageRef: string): Promise<NetworkSummary> {
    const targetId = await this.resolveTargetId(pageRef);
    await this.attachSession(targetId);
    return this.networkSnapshot(targetId);
  }

  public async cdp<TValue = unknown>(pageRef: string, method: string, params?: Record<string, unknown>): Promise<TValue> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await this.client.send<TValue>(method, params ?? {}, sessionId);
  }

  public async goto(pageRef: string, url: string): Promise<ActionResult<string>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    await this.client.send('Page.navigate', { url }, sessionId);
    await this.client.waitForEvent('Page.loadEventFired', { sessionId, timeoutMs: 30_000 }).catch(() => undefined);
    await this.refreshTargets();
    const page = this.toPageSummary(targetId);
    return { ok: true, page, url: page.url, title: page.title, value: url };
  }

  public async reload(pageRef: string): Promise<ActionResult<string>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    await this.client.send('Page.reload', {}, sessionId);
    await this.client.waitForEvent('Page.loadEventFired', { sessionId, timeoutMs: 30_000 }).catch(() => undefined);
    await this.refreshTargets();
    const page = this.toPageSummary(targetId);
    return { ok: true, page, url: page.url, title: page.title, value: page.url };
  }

  public async dispose(): Promise<void> {
    for (const state of this.sessions.values()) {
      for (const dispose of state.disposers) {
        dispose();
      }
    }
    this.sessions.clear();
    await this.client.close();
  }

  private async bootstrap(): Promise<void> {
    await this.client.send('Target.setDiscoverTargets', { discover: true });
    this.client.onEvent<TargetInfo>('Target.targetCreated', (params) => {
      this.upsertTarget(params);
    });
    this.client.onEvent<TargetInfo>('Target.targetInfoChanged', (params) => {
      this.upsertTarget(params);
    });
    this.client.onEvent<{ targetId: string }>('Target.targetDestroyed', (params) => {
      this.targets.delete(params.targetId);
      this.sessions.delete(params.targetId);
    });
    await this.refreshTargets();
  }

  private async refreshTargets(): Promise<void> {
    const result = await this.client.send<{ targetInfos: TargetInfo[] }>('Target.getTargets', {});
    for (const target of result.targetInfos.filter((item) => item.type === 'page')) {
      this.upsertTarget(target);
    }
  }

  private upsertTarget(target: TargetInfo): void {
    if (target.type !== 'page') {
      return;
    }

    this.targets.set(target.targetId, {
      ...target,
      lastSeenAt: new Date().toISOString(),
    });
  }

  private findAlias(targetId: string): string | null {
    for (const [alias, value] of this.aliases.entries()) {
      if (value === targetId) {
        return alias;
      }
    }

    return null;
  }

  private async resolveTargetId(pageRef: string): Promise<string> {
    await this.refreshTargets();

    if (this.aliases.has(pageRef)) {
      return this.aliases.get(pageRef) as string;
    }

    if (this.targets.has(pageRef)) {
      return pageRef;
    }

    const byPrefix = [...this.targets.keys()].filter((targetId) => targetId.startsWith(pageRef));
    if (byPrefix.length === 1) {
      return byPrefix[0];
    }

    const byUrl = [...this.targets.values()].filter((page) => page.url.includes(pageRef));
    if (byUrl.length === 1) {
      return byUrl[0].targetId;
    }

    const byTitle = [...this.targets.values()].filter((page) => page.title.toLowerCase().includes(pageRef.toLowerCase()));
    if (byTitle.length === 1) {
      return byTitle[0].targetId;
    }

    throw new BridgeError('PAGE_NOT_FOUND', `Unable to resolve page reference "${pageRef}" in browser ${this.id}.`);
  }

  private async attachSession(targetId: string): Promise<string> {
    const existing = this.sessions.get(targetId);
    if (existing) {
      return existing.sessionId;
    }

    const attached = await this.client.send<{ sessionId: string }>(
      'Target.attachToTarget',
      {
        targetId,
        flatten: true,
      },
    );

    const state: SessionState = {
      sessionId: attached.sessionId,
      targetId,
      network: {
        requests: new Map(),
        inflight: new Set(),
      },
      disposers: [],
    };

    await this.client.send('Page.enable', {}, state.sessionId);
    await this.client.send('Runtime.enable', {}, state.sessionId);
    await this.client.send('Network.enable', {}, state.sessionId);

    state.disposers.push(
      this.client.onEvent<{ requestId: string; request: { url: string; method: string }; type?: string }>(
        'Network.requestWillBeSent',
        (params) => {
          const entry: NetworkRequestSummary = {
            id: params.requestId,
            url: params.request.url,
            method: params.request.method,
            failed: false,
            resourceType: params.type,
            startedAt: new Date().toISOString(),
          };
          state.network.requests.set(params.requestId, entry);
          state.network.inflight.add(params.requestId);
        },
        state.sessionId,
      ),
    );

    state.disposers.push(
      this.client.onEvent<{ requestId: string; response: { status: number } }>(
        'Network.responseReceived',
        (params) => {
          const existingRequest = state.network.requests.get(params.requestId);
          if (existingRequest) {
            existingRequest.status = params.response.status;
            existingRequest.finishedAt = new Date().toISOString();
          }
        },
        state.sessionId,
      ),
    );

    state.disposers.push(
      this.client.onEvent<{ requestId: string }>(
        'Network.loadingFinished',
        (params) => {
          state.network.inflight.delete(params.requestId);
          const existingRequest = state.network.requests.get(params.requestId);
          if (existingRequest && !existingRequest.finishedAt) {
            existingRequest.finishedAt = new Date().toISOString();
          }
        },
        state.sessionId,
      ),
    );

    state.disposers.push(
      this.client.onEvent<{ requestId: string; errorText?: string }>(
        'Network.loadingFailed',
        (params) => {
          state.network.inflight.delete(params.requestId);
          const existingRequest = state.network.requests.get(params.requestId);
          if (existingRequest) {
            existingRequest.failed = true;
            existingRequest.errorText = params.errorText;
            existingRequest.finishedAt = new Date().toISOString();
          }
        },
        state.sessionId,
      ),
    );

    state.disposers.push(
      this.client.onEvent<{ frame: { parentId?: string; url: string } }>(
        'Page.frameNavigated',
        (params) => {
          if (params.frame.parentId) {
            return;
          }
          const current = this.targets.get(targetId);
          if (current) {
            current.url = params.frame.url;
            current.lastSeenAt = new Date().toISOString();
          }
        },
        state.sessionId,
      ),
    );

    this.sessions.set(targetId, state);
    return state.sessionId;
  }

  private toPageSummary(targetId: string): PageSummary {
    const target = this.targets.get(targetId);
    ensure(target, 'PAGE_MISSING', `Page ${targetId} is no longer tracked.`);
    return {
      browserId: this.id,
      targetId,
      alias: this.findAlias(targetId),
      title: target.title,
      url: target.url,
      mode: this.mode,
      attached: this.sessions.has(targetId),
      lastSeenAt: target.lastSeenAt,
    };
  }

  private networkSnapshot(targetId: string): NetworkSummary {
    const session = this.sessions.get(targetId);
    const page = this.toPageSummary(targetId);
    const requests = session ? [...session.network.requests.values()] : [];
    requests.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    return {
      browserId: this.id,
      page,
      inflightCount: session?.network.inflight.size ?? 0,
      recent: requests.slice(0, 25),
      failed: requests.filter((request) => request.failed).slice(0, 25),
    };
  }
}
