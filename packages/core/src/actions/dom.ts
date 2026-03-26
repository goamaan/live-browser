import { writeFile } from 'node:fs/promises';
import { defaultScreenshotPath } from '../shared/paths.js';
import type { ActionResult, LocatorSpec, NetworkSummary, PageSummary, SnapshotResult, WaitForOptions } from '../shared/types.js';
import { normalizeLocator, describeLocator } from '../snapshot/locator.js';
import { buildSnapshotTree, diffSnapshotTrees, snapshotExpression } from '../snapshot/semantic.js';
import type { CdpClient } from '../cdp/client.js';
import { BridgeError } from '../shared/errors.js';

const DOM_HELPERS = `
  const __bbNormalized = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const __bbRoleMap = new Map([
    ['A', 'link'],
    ['BUTTON', 'button'],
    ['INPUT', 'textbox'],
    ['SELECT', 'combobox'],
    ['TEXTAREA', 'textbox'],
    ['IMG', 'img'],
    ['UL', 'list'],
    ['OL', 'list'],
    ['LI', 'listitem'],
    ['TABLE', 'table'],
    ['TR', 'row'],
    ['TD', 'cell'],
    ['TH', 'columnheader'],
    ['H1', 'heading'],
    ['H2', 'heading'],
    ['H3', 'heading'],
    ['H4', 'heading'],
    ['H5', 'heading'],
    ['H6', 'heading']
  ]);
  const __bbImplicitRole = (el) => {
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      return 'textbox';
    }
    return __bbRoleMap.get(tag) || '';
  };
  const __bbAccessibleName = (el) => {
    const aria = __bbNormalized(el.getAttribute('aria-label'));
    if (aria) return aria;
    const labelledBy = __bbNormalized(el.getAttribute('aria-labelledby'));
    if (labelledBy) {
      const parts = labelledBy.split(' ').map((id) => __bbNormalized(document.getElementById(id)?.textContent)).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      const labels = Array.from(document.querySelectorAll('label')).filter((label) => {
        const htmlFor = label.getAttribute('for');
        return (htmlFor && htmlFor === el.id) || label.contains(el);
      });
      const labelText = __bbNormalized(labels.map((label) => label.textContent).join(' '));
      if (labelText) return labelText;
    }
    return __bbNormalized(el.textContent).slice(0, 120);
  };
  const __bbMatches = (el, locator) => {
    const role = __bbNormalized(el.getAttribute('role')) || __bbImplicitRole(el);
    const name = __bbAccessibleName(el);
    const text = __bbNormalized(el.textContent);
    const testId = __bbNormalized(el.getAttribute('data-testid') || el.getAttribute('data-test-id'));
    switch (locator.kind) {
      case 'css':
        return false;
      case 'role':
        return role === locator.value || (role + '|' + name) === locator.value;
      case 'text':
        return text.includes(locator.value || '');
      case 'label':
        return name.includes(locator.value || '');
      case 'testid':
        return testId === locator.value;
      case 'object':
        return (!locator.role || role === locator.role)
          && (!locator.name || name.includes(locator.name))
          && (!locator.text || text.includes(locator.text))
          && (!locator.label || name.includes(locator.label))
          && (!locator.testId || testId === locator.testId);
      default:
        return false;
    }
  };
  const __bbFind = (locator) => {
    if (locator.kind === 'css') {
      return document.querySelector(locator.value);
    }
    const matches = Array.from(document.querySelectorAll('*')).filter((element) => __bbMatches(element, locator));
    return matches[locator.nth || 0] || null;
  };
`;

interface RuntimeEvaluateResponse<TValue> {
  result: {
    value?: TValue;
    description?: string;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
    };
  };
}

async function runtimeEvaluate<TValue>(
  client: CdpClient,
  sessionId: string,
  expression: string,
): Promise<TValue> {
  const response = await client.send<RuntimeEvaluateResponse<TValue>>(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
    },
    sessionId,
  );

  if (response.exceptionDetails) {
    throw new BridgeError(
      'RUNTIME_EVALUATE_FAILED',
      response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Runtime.evaluate failed.',
    );
  }

  return response.result.value as TValue;
}

async function runtimeExpressionResult(
  client: CdpClient,
  sessionId: string,
  expression: string,
): Promise<{ url: string; title: string }> {
  return await runtimeEvaluate(client, sessionId, expression);
}

export async function captureSnapshot(
  client: CdpClient,
  sessionId: string,
  page: PageSummary,
  previousNodes?: SnapshotResult['nodes'],
): Promise<SnapshotResult> {
  const payload = await runtimeEvaluate<{
    url: string;
    title: string;
    nodes: Array<{
      id: string;
      parentId: string | null;
      role: string;
      name: string;
      text: string;
      locators: string[];
      box: SnapshotResult['nodes'][number]['box'];
      visible: boolean;
      disabled: boolean;
      framePath: string[];
    }>;
  }>(client, sessionId, snapshotExpression());

  const nodes = buildSnapshotTree(payload);
  const diff = diffSnapshotTrees(previousNodes, nodes);

  return {
    page,
    url: payload.url,
    title: payload.title,
    nodes,
    ...diff,
  };
}

export async function captureScreenshot(
  client: CdpClient,
  sessionId: string,
  page: PageSummary,
  filePath?: string,
): Promise<ActionResult<string>> {
  await client.send('Page.enable', {}, sessionId);
  const result = await client.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, sessionId);
  const outputPath = filePath ?? defaultScreenshotPath(page.browserId, page.targetId);
  await writeFile(outputPath, Buffer.from(result.data, 'base64'));

  return {
    ok: true,
    page,
    url: page.url,
    title: page.title,
    value: outputPath,
    screenshotPath: outputPath,
  };
}

export async function captureHtml(
  client: CdpClient,
  sessionId: string,
  page: PageSummary,
  locator?: LocatorSpec,
): Promise<ActionResult<string>> {
  const expression = locator
    ? `(() => { ${DOM_HELPERS} const locator = ${JSON.stringify(normalizeLocator(locator))}; const element = __bbFind(locator); return { url: location.href, title: document.title, value: element ? element.outerHTML : '' }; })()`
    : `(() => ({ url: location.href, title: document.title, value: document.documentElement.outerHTML }))()`;

  const result = await runtimeExpressionResult(client, sessionId, expression) as { url: string; title: string; value: string };

  return {
    ok: true,
    page,
    url: result.url,
    title: result.title,
    locator: locator ? describeLocator(locator) : undefined,
    value: result.value,
  };
}

export async function evaluateInPage<TValue>(
  client: CdpClient,
  sessionId: string,
  page: PageSummary,
  expression: string,
): Promise<ActionResult<TValue>> {
  const wrapped = `(() => {
    const value = (${expression});
    return Promise.resolve(value).then((resolved) => ({
      url: location.href,
      title: document.title,
      value: resolved
    }));
  })()`;

  const result = await runtimeEvaluate<{ url: string; title: string; value: TValue }>(client, sessionId, wrapped);

  return {
    ok: true,
    page,
    url: result.url,
    title: result.title,
    value: result.value,
  };
}

async function resolveElementCenter(
  client: CdpClient,
  sessionId: string,
  locator: LocatorSpec,
): Promise<{ url: string; title: string; x: number; y: number; locator: string }> {
  const normalized = normalizeLocator(locator);
  const expression = `(() => {
    ${DOM_HELPERS}
    const locator = ${JSON.stringify(normalized)};
    const element = __bbFind(locator);
    if (!element) {
      throw new Error('Element not found for locator: ${describeLocator(locator)}');
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return {
      url: location.href,
      title: document.title,
      x: rect.left + (rect.width / 2),
      y: rect.top + (rect.height / 2),
      locator: ${JSON.stringify(describeLocator(locator))}
    };
  })()`;

  return await runtimeEvaluate(client, sessionId, expression);
}

export async function clickElement(
  client: CdpClient,
  sessionId: string,
  page: PageSummary,
  locator: LocatorSpec,
): Promise<ActionResult> {
  const point = await resolveElementCenter(client, sessionId, locator);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' }, sessionId);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);

  return {
    ok: true,
    page,
    url: point.url,
    title: point.title,
    locator: point.locator,
  };
}

export async function hoverElement(
  client: CdpClient,
  sessionId: string,
  page: PageSummary,
  locator: LocatorSpec,
): Promise<ActionResult> {
  const point = await resolveElementCenter(client, sessionId, locator);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' }, sessionId);

  return {
    ok: true,
    page,
    url: point.url,
    title: point.title,
    locator: point.locator,
  };
}

export async function fillElement(
  client: CdpClient,
  sessionId: string,
  page: PageSummary,
  locator: LocatorSpec,
  value: string,
): Promise<ActionResult<string>> {
  const normalized = normalizeLocator(locator);
  const expression = `(() => {
    ${DOM_HELPERS}
    const locator = ${JSON.stringify(normalized)};
    const element = __bbFind(locator);
    if (!element) {
      throw new Error('Element not found for locator: ${describeLocator(locator)}');
    }
    if (!('value' in element) && !element.isContentEditable) {
      throw new Error('Element does not support fill');
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus();
    if (element.isContentEditable) {
      element.textContent = ${JSON.stringify(value)};
    } else {
      element.value = ${JSON.stringify(value)};
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      url: location.href,
      title: document.title,
      value: ${JSON.stringify(value)},
      locator: ${JSON.stringify(describeLocator(locator))}
    };
  })()`;

  const result = await runtimeEvaluate<{ url: string; title: string; value: string; locator: string }>(client, sessionId, expression);

  return {
    ok: true,
    page,
    url: result.url,
    title: result.title,
    locator: result.locator,
    value: result.value,
  };
}

export async function typeIntoElement(
  client: CdpClient,
  sessionId: string,
  page: PageSummary,
  locator: LocatorSpec,
  value: string,
): Promise<ActionResult<string>> {
  const normalized = normalizeLocator(locator);
  const focusExpression = `(() => {
    ${DOM_HELPERS}
    const locator = ${JSON.stringify(normalized)};
    const element = __bbFind(locator);
    if (!element) {
      throw new Error('Element not found for locator: ${describeLocator(locator)}');
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus();
    return {
      url: location.href,
      title: document.title,
      locator: ${JSON.stringify(describeLocator(locator))}
    };
  })()`;

  const result = await runtimeEvaluate<{ url: string; title: string; locator: string }>(client, sessionId, focusExpression);
  await client.send('Input.insertText', { text: value }, sessionId);

  return {
    ok: true,
    page,
    url: result.url,
    title: result.title,
    locator: result.locator,
    value,
  };
}

export async function pressKey(
  client: CdpClient,
  sessionId: string,
  page: PageSummary,
  key: string,
): Promise<ActionResult<string>> {
  const keyMap: Record<string, { key: string; code: string; windowsVirtualKeyCode: number }> = {
    Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  };

  const mapping = keyMap[key] ?? {
    key,
    code: key,
    windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
  };

  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...mapping, text: key.length === 1 ? key : undefined }, sessionId);
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...mapping }, sessionId);
  const result = await runtimeEvaluate<{ url: string; title: string }>(client, sessionId, `(() => ({ url: location.href, title: document.title }))()`);

  return {
    ok: true,
    page,
    url: result.url,
    title: result.title,
    value: key,
  };
}

export async function waitForCondition(
  client: CdpClient,
  sessionId: string,
  page: PageSummary,
  networkSummary: () => NetworkSummary,
  options: WaitForOptions,
): Promise<ActionResult<string>> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (options.url) {
      const result = await runtimeEvaluate<{ url: string; title: string }>(client, sessionId, `(() => ({ url: location.href, title: document.title }))()`);
      if (result.url.includes(options.url)) {
        return { ok: true, page, url: result.url, title: result.title, value: 'url' };
      }
    } else if (options.text) {
      const result = await runtimeEvaluate<{ url: string; title: string; found: boolean }>(
        client,
        sessionId,
        `(() => ({ url: location.href, title: document.title, found: document.body.innerText.includes(${JSON.stringify(options.text)}) }))()`,
      );
      if (result.found) {
        return { ok: true, page, url: result.url, title: result.title, value: 'text' };
      }
    } else if (options.selector) {
      const normalized = normalizeLocator(options.selector);
      const result = await runtimeEvaluate<{ url: string; title: string; found: boolean }>(
        client,
        sessionId,
        `(() => { ${DOM_HELPERS} const locator = ${JSON.stringify(normalized)}; return { url: location.href, title: document.title, found: Boolean(__bbFind(locator)) }; })()`,
      );
      if ((options.hidden && !result.found) || (!options.hidden && result.found)) {
        return { ok: true, page, url: result.url, title: result.title, locator: describeLocator(options.selector), value: 'selector' };
      }
    } else if (options.networkIdle || options.idle) {
      const net = networkSummary();
      const result = await runtimeEvaluate<{ url: string; title: string; readyState: string }>(
        client,
        sessionId,
        `(() => ({ url: location.href, title: document.title, readyState: document.readyState }))()`,
      );
      if (net.inflightCount === 0 && result.readyState === 'complete') {
        return { ok: true, page, url: result.url, title: result.title, value: options.networkIdle ? 'networkIdle' : 'idle' };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new BridgeError('WAIT_TIMEOUT', 'Timed out waiting for page condition.');
}
