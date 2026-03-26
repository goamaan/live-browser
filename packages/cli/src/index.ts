#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { cp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command, CommanderError } from 'commander';
import { BridgeDaemonClient, BridgeError, ensureDaemonRunning, toBridgeFault } from 'live-browser-internal-core';
import { connect, type BrowserBridgeClient } from 'live-browser-internal-sdk';

const program = new Command();

program.name('live-browser').description('Live-first browser automation');

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

interface SkillInstallOptions {
  global?: boolean;
  project?: string | boolean;
}

interface LoadAllCommandOptions extends BrowserOption {
  interval?: string;
}

function printSuccess(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printFailure(error: unknown): never {
  const commanderError = error instanceof CommanderError ? error : null;
  const fault =
    commanderError === null
      ? toBridgeFault(error)
      : {
          code: 'CLI_USAGE_ERROR',
          message: commanderError.message,
          retryable: false,
          recoverable: false,
          diagnostics: {
            exitCode: commanderError.exitCode,
            code: commanderError.code,
          },
        };

  console.error(
    JSON.stringify(
      {
        ok: false,
        error: fault,
      },
      null,
      2,
    ),
  );
  process.exit(commanderError?.exitCode ?? 1);
}

async function withClient<T>(run: (client: BrowserBridgeClient) => Promise<T>, options: { autoStart?: boolean } = {}): Promise<void> {
  const client = await connect({ autoStart: options.autoStart });
  try {
    printSuccess(await run(client));
  } finally {
    await client.disconnect();
  }
}

async function runExternalScript(scriptPath: string): Promise<void> {
  const resolvedScriptPath = path.resolve(scriptPath);
  const sdkModuleUrl = new URL('./sdk.js', import.meta.url).href;
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

      reject(new BridgeError('SCRIPT_FAILED', `Script process exited with code ${String(code)}.`));
    });
  });
}

function parseJsonObject(json: string): Record<string, unknown> {
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BridgeError('INVALID_JSON_OBJECT', 'The optional JSON argument must parse to an object.');
  }
  return parsed as Record<string, unknown>;
}

function parseFiniteNumber(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new BridgeError('INVALID_NUMBER_ARGUMENT', `Expected ${name} to be a finite number, received "${raw}".`);
  }
  return value;
}

function packagedSkillPath(): string {
  return fileURLToPath(new URL('../skill/live-browser', import.meta.url));
}

function globalSkillRoot(): string {
  const codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  return path.join(codexHome, 'skills');
}

function projectSkillRoot(projectOption: string | boolean | undefined): string {
  const base = typeof projectOption === 'string' ? path.resolve(projectOption) : process.cwd();
  return path.join(base, '.agents', 'skills');
}

async function installSkill(options: SkillInstallOptions): Promise<void> {
  const source = packagedSkillPath();
  const targetRoot = options.project ? projectSkillRoot(options.project) : globalSkillRoot();
  const target = path.join(targetRoot, 'live-browser');
  await mkdir(targetRoot, { recursive: true });
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
  printSuccess({
    ok: true,
    installedTo: target,
    mode: options.project ? 'project' : 'global',
  });
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
    printSuccess(await daemon.call('daemon.status'));
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

browsersCommand
  .command('detach')
  .requiredOption('--browser-id <browserId>', 'browser id')
  .description('Detach one browser session from the daemon without stopping the whole daemon.')
  .action(async (options: { browserId: string }) => {
    await withClient(async (client) => await client.detach(options.browserId));
  });

const pagesCommand = program.command('pages').description('Manage pages');

pagesCommand
  .command('list')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (options: BrowserOption) => {
    await withClient(async (client) => await client.pages(options.browser));
  });

pagesCommand
  .command('resolve <page>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, options: BrowserOption) => {
    await withClient(async (client) => await client.resolvePage(page, options.browser));
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
  .command('doctor [page]')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string | undefined, options: BrowserOption) => {
    await withClient(async (client) => await client.doctor(options.browser, page));
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
  .command('goto <page> <url>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, url: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).goto(url));
  });

program
  .command('reload <page>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).reload());
  });

program
  .command('click <page> <locator>')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, locator: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).click(locator));
  });

program
  .command('clickxy <page> <x> <y>')
  .description('Click CSS pixel coordinates within the page viewport.')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, x: string, y: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).clickPoint(parseFiniteNumber('x', x), parseFiniteNumber('y', y)));
  });

program
  .command('fill <page> <locator> <value>')
  .description('Replace the current field value and dispatch input/change events.')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, locator: string, value: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).fill(locator, value));
  });

program
  .command('type <page> <locator> <value>')
  .description('Type at the current caret position after focusing the target element.')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, locator: string, value: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).type(locator, value));
  });

program
  .command('insert-text <page> <value>')
  .description('Insert text into the currently focused element without resolving a locator first.')
  .requiredOption('--browser <browserId>', 'browser id')
  .action(async (page: string, value: string, options: BrowserOption) => {
    await withClient(async (client) => await client.page(page, options.browser).insertText(value));
  });

program
  .command('loadall <page> <locator>')
  .description('Repeatedly click a load-more style control until it disappears, disables, or hits a safety limit.')
  .requiredOption('--browser <browserId>', 'browser id')
  .option('--interval <intervalMs>', 'delay between clicks in ms')
  .action(async (page: string, locator: string, options: LoadAllCommandOptions) => {
    const intervalMs = options.interval ? parseFiniteNumber('interval', options.interval) : undefined;
    await withClient(async (client) => await client.page(page, options.browser).loadAll(locator, intervalMs));
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
      if (options.networkIdle) {
        return await handle.waitForNetworkIdle(timeout);
      }
      if (options.idle) {
        return await handle.waitForIdle(timeout);
      }
      throw new BridgeError('WAIT_MODE_REQUIRED', 'Provide --selector, --text, --url, --idle, or --network-idle.');
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
      throw new BridgeError('SCRIPT_EXPORT_REQUIRED', 'The script must export a default async function.');
    }

    const client = await connect();
    try {
      printSuccess(await module.default(client));
    } finally {
      await client.disconnect();
    }
  });

const skillCommand = program.command('skill').description('Work with the packaged live-browser skill');

skillCommand
  .command('install')
  .option('--global', 'install into the standard global skills directory')
  .option('--project [dir]', 'install into a project-local .agents/skills directory')
  .action(async (options: SkillInstallOptions) => {
    if (options.global && options.project) {
      throw new BridgeError('SKILL_INSTALL_TARGET_CONFLICT', 'Choose either --global or --project, not both.');
    }

    await installSkill(options);
  });

program.exitOverride();

void program.parseAsync(process.argv).catch((error) => {
  if (
    error instanceof CommanderError &&
    (error.code === 'commander.helpDisplayed' || error.code === 'commander.version')
  ) {
    return;
  }
  printFailure(error);
});
