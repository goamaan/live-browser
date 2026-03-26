import { BridgeError } from '../shared/errors.js';

export interface JsonVersionPayload {
  webSocketDebuggerUrl: string;
}

export async function resolveHttpDebuggerUrl(endpoint: string): Promise<string | null> {
  const url = new URL(endpoint);
  url.pathname = '/json/version';
  url.search = '';
  url.hash = '';

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
    },
  }).catch(() => null);

  if (!response) {
    return null;
  }

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new BridgeError('CDP_HTTP_ERROR', `HTTP ${response.status} while resolving ${url.toString()}`);
  }

  const payload = (await response.json()) as Partial<JsonVersionPayload>;
  if (!payload.webSocketDebuggerUrl) {
    throw new BridgeError('CDP_HTTP_PAYLOAD', `No webSocketDebuggerUrl found at ${url.toString()}`);
  }

  return payload.webSocketDebuggerUrl;
}

