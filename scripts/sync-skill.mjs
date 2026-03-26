import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');
const sourceDir = path.join(root, '.agents', 'skills', 'live-browser');
const targetDir = path.join(root, 'packages', 'cli', 'skill', 'live-browser');

if (!existsSync(sourceDir)) {
  throw new Error(`Missing source skill directory: ${sourceDir}`);
}

if (checkOnly) {
  const equal = await compareDirectories(sourceDir, targetDir);
  if (!equal) {
    throw new Error('Packaged CLI skill is stale. Run `bun run skill:sync`.');
  }
  process.exit(0);
}

await mkdir(path.dirname(targetDir), { recursive: true });
await rm(targetDir, { recursive: true, force: true });
await cp(sourceDir, targetDir, { recursive: true });

// Keep package metadata files present for npm pack and install flows.
await writeFile(path.join(root, 'packages', 'cli', 'LICENSE'), await readFile(path.join(root, 'LICENSE'), 'utf8'));
await writeFile(path.join(root, 'packages', 'core', 'LICENSE'), await readFile(path.join(root, 'LICENSE'), 'utf8'));
await writeFile(path.join(root, 'packages', 'sdk', 'LICENSE'), await readFile(path.join(root, 'LICENSE'), 'utf8'));

async function compareDirectories(leftDir, rightDir) {
  if (!existsSync(rightDir)) {
    return false;
  }

  const leftFiles = await collectFiles(leftDir);
  const rightFiles = await collectFiles(rightDir);
  if (leftFiles.length !== rightFiles.length) {
    return false;
  }

  for (let index = 0; index < leftFiles.length; index += 1) {
    if (leftFiles[index] !== rightFiles[index]) {
      return false;
    }

    const [leftContent, rightContent] = await Promise.all([
      readFile(path.join(leftDir, leftFiles[index]), 'utf8'),
      readFile(path.join(rightDir, rightFiles[index]), 'utf8'),
    ]);
    if (leftContent !== rightContent) {
      return false;
    }
  }

  return true;
}

async function collectFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path.join(directory, entry.name), relativePath)));
      continue;
    }
    files.push(relativePath);
  }
  return files;
}
