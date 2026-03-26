import type { BrowserBridgeClient } from 'live-browser-internal-sdk';

export default async function run(client: BrowserBridgeClient): Promise<unknown> {
  return await client.status();
}
