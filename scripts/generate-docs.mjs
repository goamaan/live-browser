import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');
const cliPath = path.join(root, 'packages', 'cli', 'dist', 'index.js');

if (!existsSync(cliPath)) {
  throw new Error('Build the CLI before generating docs. Missing packages/cli/dist/index.js.');
}

const sections = [
  ['live-browser --help', [cliPath, '--help']],
  ['live-browser daemon --help', [cliPath, 'daemon', '--help']],
  ['live-browser browsers --help', [cliPath, 'browsers', '--help']],
  ['live-browser pages --help', [cliPath, 'pages', '--help']],
  ['live-browser skill --help', [cliPath, 'skill', '--help']],
];

const rendered = sections
  .map(([title, args]) => `### ${title}\n\n\`\`\`text\n${runNode(args).trim()}\n\`\`\``)
  .join('\n\n');

const files = [
  path.join(root, 'docs', 'cli.md'),
  path.join(root, '.agents', 'skills', 'live-browser', 'references', 'commands.md'),
];

let changed = false;
for (const filePath of files) {
  const current = await readFile(filePath, 'utf8');
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const next = replaceGeneratedBlock(current, rendered, eol);
  if (current !== next) {
    changed = true;
    if (!checkOnly) {
      await writeFile(filePath, next, 'utf8');
    }
  }
}

if (checkOnly && changed) {
  throw new Error('Generated command documentation is stale. Run `bun run docs:generate` after building the CLI.');
}

if (!checkOnly) {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'sync-skill.mjs')], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
}

function runNode(args) {
  return execFileSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
}

function replaceGeneratedBlock(content, generated, eol) {
  const start = '<!-- GENERATED:CLI-REFERENCE:START -->';
  const end = '<!-- GENERATED:CLI-REFERENCE:END -->';
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Missing generated CLI markers in ${content.slice(0, 80)}...`);
  }

  const before = content.slice(0, startIndex + start.length);
  const after = content.slice(endIndex);
  return `${before}${eol}${eol}${generated.replace(/\n/g, eol)}${eol}${after}`;
}
