import { existsSync } from 'node:fs';
import { CdpClient } from '../cdp/client.js';
import { resolveLiveBrowserEndpoint } from '../cdp/discovery.js';
import {
  captureHtml,
  captureScreenshot,
  captureSnapshot,
  clickElement,
  clickPoint,
  evaluateInPage,
  fillElement,
  hoverElement,
  insertFocusedText,
  loadAllElements,
  pressKey,
  typeIntoElement,
  waitForCondition,
} from '../actions/dom.js';
import type {
  ActionResult,
  BrowserDoctorCheck,
  BrowserDoctorResult,
  BrowserSummary,
  LiveBrowserAttachOptions,
  LoadAllDetails,
  LocatorSpec,
  NetworkRequestSummary,
  NetworkSummary,
  PageSummary,
  SnapshotResult,
  WaitForOptions,
} from '../shared/types.js';
import { BridgeError, ensure } from '../shared/errors.js';
import {
  type BrowserStateRecord,
  type PersistedAliasRecord,
  type PersistedPageRecord,
  readBrowserState,
  writeBrowserState,
} from '../shared/state.js';
import { browserStatePath } from '../shared/paths.js';
import type { BrowserSessionAdapter } from './base.js';

interface TargetInfo {
  targetId: string;
  title: string;
  url: string;
  type: string;
}

interface TrackedTargetInfo extends TargetInfo {
  lastSeenAt: string;
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

const RECOVERABLE_CODES = new Set([
  'CDP_CLOSED',
  'CDP_CONNECT_FAILED',
  'CDP_NOT_CONNECTED',
  'CDP_TIMEOUT',
  'PAGE_MISSING',
  'PAGE_NOT_FOUND',
  'TARGET_DETACHED',
  'TARGET_GONE',
]);

export class LiveBrowserSession implements BrowserSessionAdapter {
  public readonly mode = 'live' as const;

  private readonly aliases = new Map<string, PersistedAliasRecord>();
  private readonly targets = new Map<string, TrackedTargetInfo>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly snapshotTracks = new Map<string, SnapshotResult['nodes']>();
  private readonly statePath: string;
  private readonly attachOptions: LiveBrowserAttachOptions;
  private readonly attachedAt: string;
  private disposed = false;
  private label: string;
  private source: string;
  private endpoint: string;
  private client: CdpClient;

  private constructor(
    browserId: string,
    options: LiveBrowserAttachOptions,
    label: string,
    source: string,
    endpoint: string,
    client: CdpClient,
    attachedAt: string,
  ) {
    this.id = browserId;
    this.attachOptions = { ...options, browserId };
    this.label = label;
    this.source = source;
    this.endpoint = endpoint;
    this.client = client;
    this.attachedAt = attachedAt;
    this.statePath = browserStatePath(browserId);
  }

  public readonly id: string;

  public static async create(options: LiveBrowserAttachOptions): Promise<LiveBrowserSession> {
    const resolution = await resolveLiveBrowserEndpoint(options);
    const client = new CdpClient();
    await client.connect(resolution.wsEndpoint);

    const session = new LiveBrowserSession(
      options.browserId,
      options,
      options.label ?? options.browserId,
      resolution.source,
      resolution.wsEndpoint,
      client,
      new Date().toISOString(),
    );

    const persisted = await readBrowserState(options.browserId);
    await session.bootstrap(persisted);
    await session.persistState();
    return session;
  }

  public static async restore(state: BrowserStateRecord): Promise<LiveBrowserSession> {
    ensure(state.liveOptions, 'LIVE_OPTIONS_REQUIRED', `Persisted state for ${state.browserId} is missing live attach options.`);
    const resolution = await resolveLiveBrowserEndpoint(state.liveOptions);
    const client = new CdpClient();
    await client.connect(resolution.wsEndpoint);

    const session = new LiveBrowserSession(
      state.browserId,
      state.liveOptions,
      state.label,
      resolution.source,
      resolution.wsEndpoint,
      client,
      state.attachedAt,
    );

    await session.bootstrap(state);
    await session.persistState();
    return session;
  }

  public summary(): BrowserSummary {
    return {
      id: this.id,
      mode: this.mode,
      label: this.label,
      connected: this.client.isConnected(),
      source: this.source,
      endpoint: this.endpoint,
      attachedAt: this.attachedAt,
    };
  }

  public async listPages(): Promise<PageSummary[]> {
    return await this.runWithRecovery(true, 'listPages', async () => {
      await this.refreshTargets();
      await this.persistState();
      return [...this.targets.values()]
        .sort((left, right) => left.title.localeCompare(right.title))
        .map((target) => this.toPageSummary(target.targetId));
    });
  }

  public async resolvePage(pageRef: string): Promise<PageSummary> {
    return await this.runWithRecovery(true, 'resolvePage', async () => {
      const targetId = await this.resolveTargetId(pageRef);
      await this.persistState();
      return this.toPageSummary(targetId);
    });
  }

  public async doctor(pageRef?: string): Promise<BrowserDoctorResult> {
    return await this.runWithRecovery(true, 'doctor', async () => {
      await this.refreshTargets();

      const checks: BrowserDoctorCheck[] = [];
      try {
        const resolution = await resolveLiveBrowserEndpoint(this.attachOptions);
        checks.push({
          name: 'live-endpoint',
          ok: true,
          message: 'Resolved live browser endpoint.',
          diagnostics: {
            source: resolution.source,
            wsEndpoint: resolution.wsEndpoint,
            portFile: resolution.portFile,
          },
        });
      } catch (error) {
        const bridgeError = this.toBridgeError(error, 'LIVE_ENDPOINT_CHECK_FAILED');
        checks.push({
          name: 'live-endpoint',
          ok: false,
          message: bridgeError.message,
          diagnostics: bridgeError.toFault().diagnostics,
        });
      }

      checks.push({
        name: 'browser-connected',
        ok: this.client.isConnected(),
        message: this.client.isConnected() ? 'Live CDP transport is connected.' : 'Live CDP transport is disconnected.',
        diagnostics: {
          endpoint: this.endpoint,
          source: this.source,
        },
      });

      checks.push({
        name: 'alias-store',
        ok: existsSync(this.statePath),
        message: existsSync(this.statePath) ? 'Alias store is present on disk.' : 'Alias store file has not been written yet.',
        diagnostics: {
          path: this.statePath,
          aliasCount: this.aliases.size,
        },
      });

      checks.push({
        name: 'tracked-pages',
        ok: this.targets.size > 0,
        message: this.targets.size > 0 ? `Tracking ${String(this.targets.size)} page(s).` : 'No page targets are currently tracked.',
      });

      let page: BrowserDoctorResult['page'];
      if (pageRef) {
        const targetId = await this.resolveTargetId(pageRef);
        const sessionId = await this.attachSession(targetId);
        const visibility = await this.client.send<{ result: { value: { visibilityState: string; hasFocus: boolean } } }>(
          'Runtime.evaluate',
          {
            expression: `(() => ({ visibilityState: document.visibilityState, hasFocus: document.hasFocus() }))()`,
            returnByValue: true,
            awaitPromise: true,
          },
          sessionId,
        );
        const summary = this.toPageSummary(targetId);
        page = {
          ref: pageRef,
          summary,
          visibilityState: visibility.result.value.visibilityState,
          hasFocus: visibility.result.value.hasFocus,
        };
        checks.push({
          name: 'page-visibility',
          ok: true,
          message: `Resolved ${pageRef} with visibility=${page.visibilityState}.`,
          diagnostics: {
            targetId,
            hasFocus: page.hasFocus,
          },
        });
      }

      await this.persistState();
      return {
        browser: this.summary(),
        aliasCount: this.aliases.size,
        trackedPageCount: this.targets.size,
        attachedPageCount: this.sessions.size,
        aliasStorePath: this.statePath,
        page,
        checks,
      };
    });
  }

  public async setAlias(pageRef: string, alias: string): Promise<PageSummary> {
    const targetId = await this.resolveTargetId(pageRef);
    const summary = this.toPageSummary(targetId);
    this.aliases.set(alias, {
      alias,
      targetId,
      title: summary.title,
      url: summary.url,
      lastSeenAt: summary.lastSeenAt,
    });
    await this.persistState();
    return this.toPageSummary(targetId);
  }

  public async open(url = 'about:blank'): Promise<PageSummary> {
    const result = await this.client.send<{ targetId: string }>('Target.createTarget', { url });
    await this.refreshTargets();
    await this.persistState();
    return this.toPageSummary(result.targetId);
  }

  public async close(pageRef: string): Promise<ActionResult<string>> {
    const targetId = await this.resolveTargetId(pageRef);
    await this.client.send('Target.closeTarget', { targetId });
    this.targets.delete(targetId);
    this.releaseSession(targetId);
    for (const [alias, record] of this.aliases.entries()) {
      if (record.targetId === targetId) {
        this.aliases.delete(alias);
      }
    }
    await this.persistState();

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
    return await this.runWithRecovery(true, 'warm', async () => {
      const refs = pageRefs.length > 0 ? pageRefs : (await this.listPages()).map((page) => page.targetId);
      const pages: PageSummary[] = [];
      for (const ref of refs) {
        const targetId = await this.resolveTargetId(ref);
        await this.attachSession(targetId);
        pages.push(this.toPageSummary(targetId));
      }
      await this.persistState();
      return pages;
    });
  }

  public async detach(): Promise<BrowserSummary> {
    const summary = this.summary();
    await this.dispose();
    return {
      ...summary,
      connected: false,
    };
  }

  public async snapshot(pageRef: string, track?: string): Promise<SnapshotResult> {
    return await this.runWithRecovery(true, 'snapshot', async () => {
      const targetId = await this.resolveTargetId(pageRef);
      const sessionId = await this.attachSession(targetId);
      const page = this.toPageSummary(targetId);
      const trackKey = track ? `${targetId}:${track}` : undefined;
      const previous = trackKey ? this.snapshotTracks.get(trackKey) : undefined;
      const snapshot = await captureSnapshot(this.client, sessionId, page, previous);
      if (trackKey) {
        this.snapshotTracks.set(trackKey, snapshot.nodes);
      }
      await this.persistState();
      return snapshot;
    });
  }

  public async screenshot(pageRef: string, filePath?: string): Promise<ActionResult<string>> {
    return await this.runWithRecovery(true, 'screenshot', async () => {
      const targetId = await this.resolveTargetId(pageRef);
      const sessionId = await this.attachSession(targetId);
      return await captureScreenshot(this.client, sessionId, this.toPageSummary(targetId), filePath);
    });
  }

  public async html(pageRef: string, locator?: LocatorSpec): Promise<ActionResult<string>> {
    return await this.runWithRecovery(true, 'html', async () => {
      const targetId = await this.resolveTargetId(pageRef);
      const sessionId = await this.attachSession(targetId);
      return await captureHtml(this.client, sessionId, this.toPageSummary(targetId), locator);
    });
  }

  public async evaluate<TValue = unknown>(pageRef: string, expression: string): Promise<ActionResult<TValue>> {
    return await this.runWithRecovery(true, 'evaluate', async () => {
      const targetId = await this.resolveTargetId(pageRef);
      const sessionId = await this.attachSession(targetId);
      return await evaluateInPage<TValue>(this.client, sessionId, this.toPageSummary(targetId), expression);
    });
  }

  public async click(pageRef: string, locator: LocatorSpec): Promise<ActionResult> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await clickElement(this.client, sessionId, this.toPageSummary(targetId), locator);
  }

  public async clickPoint(pageRef: string, x: number, y: number): Promise<ActionResult<{ x: number; y: number }>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await clickPoint(this.client, sessionId, this.toPageSummary(targetId), x, y);
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

  public async insertText(pageRef: string, value: string): Promise<ActionResult<string>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await insertFocusedText(this.client, sessionId, this.toPageSummary(targetId), value);
  }

  public async loadAll(pageRef: string, locator: LocatorSpec, intervalMs?: number): Promise<ActionResult<LoadAllDetails>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    return await loadAllElements(this.client, sessionId, this.toPageSummary(targetId), locator, intervalMs);
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
    return await this.runWithRecovery(true, 'wait', async () => {
      const targetId = await this.resolveTargetId(pageRef);
      const sessionId = await this.attachSession(targetId);
      return await waitForCondition(this.client, sessionId, this.toPageSummary(targetId), () => this.networkSnapshot(targetId), options);
    });
  }

  public async networkSummary(pageRef: string): Promise<NetworkSummary> {
    return await this.runWithRecovery(true, 'networkSummary', async () => {
      const targetId = await this.resolveTargetId(pageRef);
      await this.attachSession(targetId);
      return this.networkSnapshot(targetId);
    });
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
    await this.persistState();
    const page = this.toPageSummary(targetId);
    return { ok: true, page, url: page.url, title: page.title, value: url };
  }

  public async reload(pageRef: string): Promise<ActionResult<string>> {
    const targetId = await this.resolveTargetId(pageRef);
    const sessionId = await this.attachSession(targetId);
    await this.client.send('Page.reload', {}, sessionId);
    await this.client.waitForEvent('Page.loadEventFired', { sessionId, timeoutMs: 30_000 }).catch(() => undefined);
    await this.refreshTargets();
    await this.persistState();
    const page = this.toPageSummary(targetId);
    return { ok: true, page, url: page.url, title: page.title, value: page.url };
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    this.releaseAllSessions();
    await this.persistState().catch(() => undefined);
    await this.client.close().catch(() => undefined);
  }

  private async bootstrap(persisted?: BrowserStateRecord | null): Promise<void> {
    this.hydrateAliases(persisted);
    await this.client.send('Target.setDiscoverTargets', { discover: true });

    this.client.onEvent<{ targetInfo: TargetInfo }>('Target.targetCreated', (params) => {
      this.upsertTarget(params.targetInfo);
      void this.persistState();
    });
    this.client.onEvent<TargetInfo>('Target.targetInfoChanged', (params) => {
      this.upsertTarget(params);
      void this.persistState();
    });
    this.client.onEvent<{ targetId: string }>('Target.targetDestroyed', (params) => {
      this.targets.delete(params.targetId);
      this.releaseSession(params.targetId);
      void this.persistState();
    });

    await this.refreshTargets();
    await this.persistState();
  }

  private hydrateAliases(persisted?: BrowserStateRecord | null): void {
    this.aliases.clear();
    for (const record of persisted?.aliases ?? []) {
      this.aliases.set(record.alias, record);
    }
  }

  private async refreshTargets(): Promise<void> {
    const result = await this.client.send<{ targetInfos: TargetInfo[] }>('Target.getTargets', {});
    const nextTargetIds = new Set<string>();
    for (const target of result.targetInfos.filter((item) => item.type === 'page')) {
      this.upsertTarget(target);
      nextTargetIds.add(target.targetId);
    }

    for (const targetId of [...this.targets.keys()]) {
      if (!nextTargetIds.has(targetId)) {
        this.targets.delete(targetId);
        this.releaseSession(targetId);
      }
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

    for (const [alias, record] of this.aliases.entries()) {
      if (record.targetId === target.targetId) {
        this.aliases.set(alias, {
          alias,
          targetId: target.targetId,
          title: target.title,
          url: target.url,
          lastSeenAt: new Date().toISOString(),
        });
      }
    }
  }

  private findAlias(targetId: string): string | null {
    for (const [alias, value] of this.aliases.entries()) {
      if (value.targetId === targetId) {
        return alias;
      }
    }

    return null;
  }

  private async resolveTargetId(pageRef: string): Promise<string> {
    await this.refreshTargets();

    const aliasRecord = this.aliases.get(pageRef);
    if (aliasRecord) {
      if (this.targets.has(aliasRecord.targetId)) {
        return aliasRecord.targetId;
      }

      const rebound = this.rebindAlias(aliasRecord);
      if (rebound) {
        this.aliases.set(pageRef, rebound);
        void this.persistState();
        return rebound.targetId;
      }
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

    throw new BridgeError('PAGE_NOT_FOUND', `Unable to resolve page reference "${pageRef}" in browser ${this.id}.`, {
      retryable: true,
      recoverable: true,
      hint: 'Use "pages list" to inspect the current targets or "pages resolve" to confirm the exact mapping.',
      diagnostics: {
        browserId: this.id,
        ref: pageRef,
        pages: [...this.targets.values()].map((page) => ({
          targetId: page.targetId,
          title: page.title,
          url: page.url,
        })),
      },
      suggestedNextSteps: [
        'Run live-browser pages list --browser <browserId> to inspect open tabs.',
        'Re-assign aliases after the browser creates new target ids.',
      ],
    });
  }

  private rebindAlias(aliasRecord: PersistedAliasRecord): PersistedAliasRecord | null {
    const exactUrl = [...this.targets.values()].filter((target) => target.url === aliasRecord.url);
    if (exactUrl.length === 1) {
      return this.toAliasRecord(aliasRecord.alias, exactUrl[0]);
    }

    const partialUrl = [...this.targets.values()].filter((target) => target.url.includes(aliasRecord.url) || aliasRecord.url.includes(target.url));
    if (partialUrl.length === 1) {
      return this.toAliasRecord(aliasRecord.alias, partialUrl[0]);
    }

    const exactTitle = [...this.targets.values()].filter((target) => target.title === aliasRecord.title);
    if (exactTitle.length === 1) {
      return this.toAliasRecord(aliasRecord.alias, exactTitle[0]);
    }

    const titleAndUrl = [...this.targets.values()].filter(
      (target) => target.title.toLowerCase().includes(aliasRecord.title.toLowerCase()) && target.url.includes(aliasRecord.url),
    );
    if (titleAndUrl.length === 1) {
      return this.toAliasRecord(aliasRecord.alias, titleAndUrl[0]);
    }

    return null;
  }

  private toAliasRecord(alias: string, target: TrackedTargetInfo): PersistedAliasRecord {
    return {
      alias,
      targetId: target.targetId,
      title: target.title,
      url: target.url,
      lastSeenAt: target.lastSeenAt,
    };
  }

  private async attachSession(targetId: string): Promise<string> {
    const existing = this.sessions.get(targetId);
    if (existing) {
      return existing.sessionId;
    }

    if (!this.targets.has(targetId)) {
      throw new BridgeError('TARGET_GONE', `Target ${targetId} is no longer tracked.`, {
        retryable: true,
        recoverable: true,
      });
    }

    const attached = await this.client.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });

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
            void this.persistState();
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
    ensure(target, 'PAGE_MISSING', `Page ${targetId} is no longer tracked.`, {
      retryable: true,
      recoverable: true,
    });
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

  private releaseSession(targetId: string): void {
    const state = this.sessions.get(targetId);
    if (!state) {
      return;
    }

    for (const dispose of state.disposers) {
      dispose();
    }
    this.sessions.delete(targetId);
  }

  private releaseAllSessions(): void {
    for (const targetId of [...this.sessions.keys()]) {
      this.releaseSession(targetId);
    }
  }

  private async persistState(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const state: BrowserStateRecord = {
      version: 1,
      browserId: this.id,
      mode: this.mode,
      label: this.label,
      attachedAt: this.attachedAt,
      updatedAt: new Date().toISOString(),
      liveOptions: this.attachOptions,
      aliases: [...this.aliases.values()].sort((left, right) => left.alias.localeCompare(right.alias)),
      pages: [...this.targets.values()]
        .map((target): PersistedPageRecord => ({
          targetId: target.targetId,
          title: target.title,
          url: target.url,
          lastSeenAt: target.lastSeenAt,
        }))
        .sort((left, right) => left.title.localeCompare(right.title)),
    };

    await writeBrowserState(state);
  }

  private async reconnectBrowser(): Promise<void> {
    const resolution = await resolveLiveBrowserEndpoint(this.attachOptions);
    const nextClient = new CdpClient();
    await nextClient.connect(resolution.wsEndpoint);

    const previousClient = this.client;
    this.releaseAllSessions();
    this.targets.clear();
    this.client = nextClient;
    this.source = resolution.source;
    this.endpoint = resolution.wsEndpoint;

    await this.bootstrap(await readBrowserState(this.id));
    await previousClient.close().catch(() => undefined);
  }

  private async runWithRecovery<T>(safeToRetry: boolean, action: string, task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      const bridgeError = this.toBridgeError(error, 'LIVE_BROWSER_ACTION_FAILED');
      if (!safeToRetry || !bridgeError.recoverable || !RECOVERABLE_CODES.has(bridgeError.code)) {
        throw bridgeError;
      }

      await this.reconnectBrowser();
      try {
        return await task();
      } catch (retryError) {
        throw this.toBridgeError(retryError, `${action.toUpperCase()}_RECOVERY_FAILED`);
      }
    }
  }

  private toBridgeError(error: unknown, fallbackCode: string): BridgeError {
    if (error instanceof BridgeError) {
      return error;
    }

    return new BridgeError(fallbackCode, error instanceof Error ? error.message : String(error), {
      retryable: false,
      recoverable: false,
      diagnostics: error instanceof Error && error.stack ? { stack: error.stack } : undefined,
    });
  }
}
