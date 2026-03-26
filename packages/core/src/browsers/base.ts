import type {
  ActionResult,
  BrowserSummary,
  LocatorSpec,
  NetworkSummary,
  PageSummary,
  SnapshotResult,
  WaitForOptions,
} from '../shared/types.js';

export interface BrowserSessionAdapter {
  readonly id: string;
  readonly mode: BrowserSummary['mode'];
  summary(): BrowserSummary;
  listPages(): Promise<PageSummary[]>;
  setAlias(pageRef: string, alias: string): Promise<PageSummary>;
  open(url?: string): Promise<PageSummary>;
  close(pageRef: string): Promise<ActionResult<string>>;
  warm(pageRefs: string[]): Promise<PageSummary[]>;
  snapshot(pageRef: string, track?: string): Promise<SnapshotResult>;
  screenshot(pageRef: string, filePath?: string): Promise<ActionResult<string>>;
  html(pageRef: string, locator?: LocatorSpec): Promise<ActionResult<string>>;
  evaluate<TValue = unknown>(pageRef: string, expression: string): Promise<ActionResult<TValue>>;
  click(pageRef: string, locator: LocatorSpec): Promise<ActionResult>;
  fill(pageRef: string, locator: LocatorSpec, value: string): Promise<ActionResult<string>>;
  type(pageRef: string, locator: LocatorSpec, value: string): Promise<ActionResult<string>>;
  press(pageRef: string, key: string): Promise<ActionResult<string>>;
  hover(pageRef: string, locator: LocatorSpec): Promise<ActionResult>;
  wait(pageRef: string, options: WaitForOptions): Promise<ActionResult<string>>;
  networkSummary(pageRef: string): Promise<NetworkSummary>;
  cdp<TValue = unknown>(pageRef: string, method: string, params?: Record<string, unknown>): Promise<TValue>;
  goto(pageRef: string, url: string): Promise<ActionResult<string>>;
  reload(pageRef: string): Promise<ActionResult<string>>;
  dispose(): Promise<void>;
}
