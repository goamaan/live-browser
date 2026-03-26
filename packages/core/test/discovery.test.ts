import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLiveBrowserEndpoint } from '../src/cdp/discovery.js';
import { resolveHttpDebuggerUrl } from '../src/cdp/protocol.js';

describe('resolveHttpDebuggerUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the browser websocket from /json/version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test-browser',
        }),
      })),
    );

    await expect(resolveHttpDebuggerUrl('http://127.0.0.1:9222')).resolves.toBe(
      'ws://127.0.0.1:9222/devtools/browser/test-browser',
    );
  });

  it('returns null when the endpoint does not expose /json/version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({
        ok: false,
        status: 404,
      })),
    );

    await expect(resolveHttpDebuggerUrl('http://127.0.0.1:9222')).resolves.toBeNull();
  });
});

describe('resolveLiveBrowserEndpoint', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers an explicit websocket endpoint', async () => {
    await expect(
      resolveLiveBrowserEndpoint({
        browserId: 'chrome',
        wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/direct',
      }),
    ).resolves.toEqual({
      wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/direct',
      source: 'explicit-ws',
    });
  });

  it('resolves explicit http endpoints through protocol discovery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/http-path',
        }),
      })),
    );

    await expect(
      resolveLiveBrowserEndpoint({
        browserId: 'chrome',
        httpEndpoint: 'http://127.0.0.1:9222',
      }),
    ).resolves.toEqual({
      wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/http-path',
      source: 'explicit-http',
    });
  });

  it('parses an explicit DevToolsActivePort file', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'browser-bridge-test-'));
    const portFile = path.join(tempDir, 'DevToolsActivePort');
    writeFileSync(portFile, '9333\n/devtools/browser/from-port-file\n', 'utf8');

    try {
      await expect(
        resolveLiveBrowserEndpoint({
          browserId: 'chrome',
          devToolsActivePortFile: portFile,
        }),
      ).resolves.toEqual({
        wsEndpoint: 'ws://127.0.0.1:9333/devtools/browser/from-port-file',
        source: 'devtools-active-port',
        portFile,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
