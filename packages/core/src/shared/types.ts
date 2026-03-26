export type BrowserMode = 'live' | 'managed';

export interface BrowserSummary {
  id: string;
  mode: BrowserMode;
  label: string;
  connected: boolean;
  source?: string;
  endpoint?: string;
  attachedAt: string;
}

export interface PageSummary {
  browserId: string;
  targetId: string;
  alias: string | null;
  title: string;
  url: string;
  mode: BrowserMode;
  attached: boolean;
  lastSeenAt: string;
}

export type LocatorSpec =
  | string
  | {
      role?: string;
      name?: string;
      text?: string;
      label?: string;
      testId?: string;
      nth?: number;
    };

export interface BoxModel {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapshotNode {
  id: string;
  role: string;
  name: string;
  text: string;
  locators: string[];
  box: BoxModel | null;
  visible: boolean;
  disabled: boolean;
  framePath: string[];
  children: SnapshotNode[];
}

export interface SnapshotResult {
  page: PageSummary;
  url: string;
  title: string;
  nodes: SnapshotNode[];
  added?: string[];
  removed?: string[];
  changed?: string[];
  screenshotPath?: string;
}

export interface ActionResult<TValue = unknown> {
  ok: boolean;
  page: PageSummary;
  url: string;
  title: string;
  locator?: string;
  value?: TValue;
  screenshotPath?: string;
  diagnostics?: Record<string, unknown>;
}

export interface WaitForOptions {
  selector?: LocatorSpec;
  text?: string;
  url?: string;
  hidden?: boolean;
  idle?: boolean;
  networkIdle?: boolean;
  timeoutMs?: number;
}

export interface NetworkRequestSummary {
  id: string;
  url: string;
  method: string;
  status?: number;
  failed: boolean;
  errorText?: string;
  resourceType?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface NetworkSummary {
  browserId: string;
  page: PageSummary;
  inflightCount: number;
  recent: NetworkRequestSummary[];
  failed: NetworkRequestSummary[];
}

export interface LiveBrowserAttachOptions {
  browserId: string;
  label?: string;
  wsEndpoint?: string;
  httpEndpoint?: string;
  devToolsActivePortFile?: string;
  host?: string;
}

export interface ManagedBrowserLaunchOptions {
  browserId: string;
  label?: string;
  headless?: boolean;
  url?: string;
}

export interface PageActionParams {
  browserId: string;
  page: string;
}

export interface PageActionWithLocatorParams extends PageActionParams {
  locator: LocatorSpec;
}

export interface PageActionWithExpressionParams extends PageActionParams {
  expression: string;
}

export interface PageActionWithFileParams extends PageActionParams {
  filePath?: string;
}

export interface RpcEnvelope<TParams = unknown> {
  id: string;
  method: string;
  params?: TParams;
}

export interface RpcResponse<TResult = unknown> {
  id: string;
  ok: boolean;
  result?: TResult;
  error?: string;
}

export interface PageLike {
  url(): Promise<string>;
  title(): Promise<string>;
  goto(url: string): Promise<ActionResult<string>>;
  reload(): Promise<ActionResult<string>>;
  locator(locator: LocatorSpec): Promise<string>;
  click(locator: LocatorSpec): Promise<ActionResult>;
  fill(locator: LocatorSpec, value: string): Promise<ActionResult<string>>;
  type(locator: LocatorSpec, value: string): Promise<ActionResult<string>>;
  press(key: string): Promise<ActionResult<string>>;
  hover(locator: LocatorSpec): Promise<ActionResult>;
  evaluate<TValue = unknown>(expression: string): Promise<ActionResult<TValue>>;
  html(locator?: LocatorSpec): Promise<ActionResult<string>>;
  snapshot(track?: string): Promise<SnapshotResult>;
  screenshot(filePath?: string): Promise<ActionResult<string>>;
  waitForSelector(locator: LocatorSpec, hidden?: boolean, timeoutMs?: number): Promise<ActionResult<string>>;
  waitForURL(url: string, timeoutMs?: number): Promise<ActionResult<string>>;
  waitForText(text: string, timeoutMs?: number): Promise<ActionResult<string>>;
  waitForIdle(timeoutMs?: number): Promise<ActionResult<string>>;
  networkSummary(): Promise<NetworkSummary>;
  cdp<TValue = unknown>(method: string, params?: Record<string, unknown>): Promise<TValue>;
}

