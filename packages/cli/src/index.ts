#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { BridgeDaemonClient, ensureDaemonRunning } from '@browser-bridge/core';
import { connect, type BrowserBridgeClient } from '@browser-bridge/sdk';

const program = new Command();

program.name('bridge').description('Live-first AI browser bridge').showHelpAfterError();

interface BrowserOption {
  browser: string;
}

interface AttachBrowserCommandOptions {
  browserId: string;
  label?: string;
  wsEndpoint?: string;
  httpEndpoint?: string;
  portFile?: string;
  host?: string;
}

interface LaunchBrowserCommandOptions {
  browserId: string;
  label?: string;
  headless?: boolean;
  url?: string;
}

interface SnapshotCommandOptions extends BrowserOption {
  track?: string;
}

interface ScreenshotCommandOptions extends BrowserOption {
  file?: string;
}

interface HtmlCommandOptions extends BrowserOption {
  locator?: string;
}

interface WaitCommandOptions extends BrowserOption {
  selector?: string;
  text?: string;
  url?: string;
  hidden?: boolean;
  idle?: boolean;
  networkIdle?: boolean;
  timeout?: string;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function withClient<T>(run: (client: BrowserBridgeClient) => Promise<T>, options: { autoStart?: boolean } = {}): Promise<void> {
  const client = await connect({ autoStart: options.autoStart });
  try {
    print(await run(client));
  } finally {
    await client.disconnect();
  }
}

async function runExternalScript(scriptPath: string): Promise<void> {
  const resolvedScriptPath = path.resolve(scriptPath);
  const sdkModuleUrl = new URL('../../sdk/dist/index.js', import.meta.url).href;
  const runner = [
    'import { pathToFileURL } from "node:url";',
    'const { connect } = await import(process.env.BROWSER_BRIDGE_SDK_MODULE_URL);',
    'const module = await import(pathToFileURL(process.env.BROWSER_BRIDGE_SCRIPT_PATH).href);',
    'if (typeof module.default !== "function") {',
    '  throw new Error("The script must export a default async function.");',
    '}',
    'const client = await connect();',
    'try {',
    '  const result = await module.default(client);',
    '  console.log(JSON.stringify(result, null, 2));',
    '} finally {',
    '  await client.disconnect();',
    '}',
  ].join('\n');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--input-type=module', '--eval', runner], {
      stdio: 'inherit',
      env: {
        ...process.env,
        BROWSER_BRIDGE_SCRIPT_PATH: resolvedScriptPath,
        BROWSER_BRIDGE_SDK_MODULE_URL: sdkModuleUrl,
      },
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Script process exited with code ${String(code)}.`));
    });
  });
}

function parseJsonObject(json: string): Record<string, unknown> {
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The optional JSON argument must parse to an object.');
  }
  return parsed as Record<string, unknown>;
}

const daemonCommand = program.command('daemon').description('Manage the local daemon');

daemonCommand.command('start').action(async () => {
  await ensureDaemonRunning();
  await withClient(async (client) => await client.status(), { autoStart: false });
});

daemonCommand.command('status').action(async () => {
  const daemon = new BridgeDaemonClient();
  await daemon.connect({ autoStart: false });
  try {
    print(await daemon.call('daemon.status'));
  } finally {
    await daemon.close();
  }
});

daemonCommand.command('stop').action(async () => {
  await withClient(async (client) => await client.stopDaemon(), { autoStart: false });
});

const browsersCommand = program.command('browsers').description('Attach or launch browsers');

browsersCommand.command('list').action(async () => {
  await withClient(async (client) => await client.browsers());
});

browsersCommand
  .command('attach')
  .requiredOption('--browser-id <browserId>', 'browser id', 'chrome')
  .option('--label <label>')
  .option('--ws-endpoint <wsEndpoint>')
  .option('--http-endpoint <httpEndpoint>')
  .option('--port-file <portFile>')
  .option('--host <host>')
  .action(async (options: AttachBrowserCommandOptions) => {
    await withClient(async (client) =>
      await client.attachLive({
        browserId: options.browserId,
        label: options.label,
        wsEndpoint: options.wsEndpoint,
        httpEndpoint: options.httpEndpoint,
        devToolsActivePortFile: options.portFile,
        host: options.host,
      }),
    );
  });

browsersCommand
  .command('launch')
  .requiredOption('--browser-id <browserId>', 'browser id', 'managed')
  .option('--label <label>')
  .option('--headless', 'launch headless')
  .option('--url <url>')
  .action(async (options: LaunchBrowserCommandOptions) => {
    await withClient(async (client) =>
      await client.launchManaged({
        browserId: options.browserId,
        label: options.label,
        headless: Boolean(options.headless),
        url: options.url,
      }),
    );
  });

const pagesCommand = program.command('pages').description('Manage pages');

pagesCommand
  .command('list')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (options: BrowserOption) => {
    await withClient(async (client) => await client.pages(options.browser));
  });

pagesCommand
  .command('alias <page> <alias>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, alias: string, options: BrowserOption) => {
    await withClient(async (client) => await client.alias(page, alias, options.browser));
  });

pagesCommand
  .command('open <url>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (url: string, options: BrowserOption) => {
    await withClient(async (client) => await client.open(url, options.browser));
  });

pagesCommand
  .command('close <page>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, options: BrowserOption) => {
    await withClient(async (client) => await client.close(page, options.browser));
  });

pagesCommand
  .command('warm [pages...]')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (pages: string[] | undefined, options: BrowserOption) => {
    await withClient(async (client) => await client.warm(pages ?? [], options.browser));
  });

program
  .command('snapshot <page>')
  .requiredOption('--browser <browserId>', 'browser id')
  .option('--track <track>')
  .action(async (page: string, options: SnapshotCommandOptions) => {
    await withClient(async (client) => await client.page(page, options.browser).snapshot(options.track));
  });

program
  .command('screenshot <page>')
  .requiredOption('--browser <browserId>', 'browser id')
  .option('--file <filePath>')
  .action(async (page: string, options: ScreenshotCommandOptions) => {
    await withClient(async (client) => await client.page(page, options.browser).screenshot(options.file));
  });

program
  .command('html <page>')
  .requiredOption('--browser <browserId>', 'browser id')
  .option('--locator <locator>')
  .action(async (page: string, options: HtmlCommandOptions) => {
    await withClient(async (client) => await client.page(page, options.browser).html(options.locator));
  });

program
  .command('evaluate <page> <expression>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, expression: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).evaluate(expression));
  });

program
  .command('click <page> <locator>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, locator: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).click(locator));
  });

program
  .command('fill <page> <locator> <value>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, locator: string, value: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).fill(locator, value));
  });

program
  .command('type <page> <locator> <value>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, locator: string, value: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).type(locator, value));
  });

program
  .command('press <page> <key>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, key: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).press(key));
  });

program
  .command('hover <page> <locator>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, locator: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).hover(locator));
  });

program
  .command('wait <page>')
  .requiredOption('--browser <browserId>', 'browser id')
  .option('--selector <selector>')
  .option('--text <text>')
  .option('--url <url>')
  .option('--hidden', 'wait for selector hidden')
  .option('--idle', 'wait for app idle')
  .option('--network-idle', 'wait for network idle')
  .option('--timeout <timeoutMs>', 'timeout in ms')
  .action(async (page: string, options: WaitCommandOptions) => {
    const timeout = options.timeout ? Number(options.timeout) : undefined;
    await withClient(async (client) => {
      const handle = client.page(page, options.browser);
      if (options.selector) {
        return await handle.waitForSelector(options.selector, options.hidden, timeout);
      }
      if (options.text) {
        return await handle.waitForText(options.text, timeout);
      }
      if (options.url) {
        return await handle.waitForURL(options.url, timeout);
      }
      if (options.idle || options.networkIdle) {
        return await handle.waitForIdle(timeout);
      }
      throw new Error('Provide --selector, --text, --url, --idle, or --network-idle.');
    });
  });

program
  .command('network <page>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).networkSummary());
  });

program
  .command('cdp <page> <method> [json]')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, method: string, json: string | undefined, options: BrowserOption) => {
    await withClient(async (client) =>
      await client.page(page, options.browser).cdp(method, json ? parseJsonObject(json) : undefined),
    );
  });

program
  .command('run <scriptPath>')
  .description('Run a local JS or TS script that exports a default async function')
  .action(async (scriptPath: string) => {
    if (scriptPath.endsWith('.ts') || scriptPath.endsWith('.mts') || scriptPath.endsWith('.cts')) {
      await runExternalScript(scriptPath);
      return;
    }

    const module = (await import(pathToFileURL(path.resolve(scriptPath)).href)) as {
      default?: (client: BrowserBridgeClient) => Promise<unknown>;
    };
    if (typeof module.default !== 'function') {
      throw new Error('The script must export a default async function.');
    }

    const client = await connect();
    try {
      print(await module.default(client));
    } finally {
      await client.disconnect();
    }
  });

void program.parseAsync(process.argv);
