import path from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const root = process.cwd();
const distDir = path.join(root, 'packages', 'cli', 'dist');
const coreDistEntry = path.join(root, 'packages', 'core', 'dist', 'index.js');
const sdkDistEntry = path.join(root, 'packages', 'sdk', 'dist', 'index.js');
const cliDistEntry = path.join(root, 'packages', 'cli', 'dist', 'index.js');
const cliOutput = path.join(distDir, 'index.js');
const sdkOutput = path.join(distDir, 'sdk.js');

const tempDir = path.join(root, 'packages', 'cli', '.bundle-temp');

try {
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  const cliBundleEntry = path.join(tempDir, 'cli-entry.mjs');
  const sdkBundleEntry = path.join(tempDir, 'sdk-entry.mjs');

  await writeFile(
    cliBundleEntry,
    rewriteImports(await readFile(cliDistEntry, 'utf8'), [
      ['live-browser-internal-core', relativeImport(cliBundleEntry, coreDistEntry)],
      ['live-browser-internal-sdk', relativeImport(cliBundleEntry, sdkDistEntry)],
    ]),
    'utf8',
  );
  await writeFile(
    sdkBundleEntry,
    rewriteImports(await readFile(sdkDistEntry, 'utf8'), [['live-browser-internal-core', relativeImport(sdkBundleEntry, coreDistEntry)]]),
    'utf8',
  );

  await bundle(cliBundleEntry, cliOutput);
  await bundle(sdkBundleEntry, sdkOutput);
  await ensureCliShebang(cliOutput);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function bundle(entrypoint, outfile) {
  await build({
    entryPoints: [entrypoint],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    sourcemap: true,
    packages: 'external',
    external: ['playwright'],
    legalComments: 'none',
  });
}

async function ensureCliShebang(filePath) {
  const file = Bun.file(filePath);
  const current = await file.text();
  if (current.startsWith('#!/usr/bin/env node')) {
    return;
  }

  await Bun.write(filePath, `#!/usr/bin/env node\n${current}`);
}

function rewriteImports(source, replacements) {
  return replacements.reduce(
    (next, [from, to]) => next.replaceAll(`from '${from}'`, `from '${to}'`).replaceAll(`from "${from}"`, `from "${to}"`),
    source,
  );
}

function relativeImport(fromFile, toFile) {
  const relativePath = path.relative(path.dirname(fromFile), toFile).split(path.sep).join('/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}
