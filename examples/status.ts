import type { BrowserBridgeClient } from '@browser-bridge/sdk';

export default async function run(client: BrowserBridgeClient): Promise<unknown> {
  return await client.status();
}
