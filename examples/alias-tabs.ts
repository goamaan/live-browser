import type { PageSummary } from 'live-browser-internal-core';
import type { BrowserBridgeClient } from 'live-browser-internal-sdk';

interface AliasTarget {
  alias: string;
  description: string;
  matches: (page: PageSummary) => boolean;
}

const browserId = process.env.BROWSER_BRIDGE_BROWSER_ID ?? 'chrome';
const localPrefix = process.env.BROWSER_BRIDGE_LOCAL_URL ?? 'http://localhost:3000/';
const remotePrefix = process.env.BROWSER_BRIDGE_REMOTE_URL ?? 'https://example.com/';

const targets: AliasTarget[] = [
  {
    alias: 'local-app',
    description: `Local app tab (${localPrefix})`,
    matches: (page) => page.url.startsWith(localPrefix),
  },
  {
    alias: 'remote-app',
    description: `Remote app tab (${remotePrefix})`,
    matches: (page) => page.url.startsWith(remotePrefix),
  },
];

export default async function run(client: BrowserBridgeClient): Promise<unknown> {
  const pages = await client.pages(browserId);
  const matched: Array<{
    alias: string;
    description: string;
    targetId: string;
    title: string;
    url: string;
  }> = [];
  const missing: string[] = [];

  for (const target of targets) {
    const page = pages.find((candidate) => target.matches(candidate));
    if (!page) {
      missing.push(target.description);
      continue;
    }

    await client.alias(page.targetId, target.alias, browserId);
    matched.push({
      alias: target.alias,
      description: target.description,
      targetId: page.targetId,
      title: page.title,
      url: page.url,
    });
  }

  const warmed = matched.length > 0 ? await client.warm(matched.map((entry) => entry.alias), browserId) : [];

  return {
    browser: browserId,
    matched,
    missing,
    warmed,
  };
}
