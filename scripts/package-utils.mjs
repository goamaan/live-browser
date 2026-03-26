import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const root = process.cwd();

export const publicPackages = [
  {
    name: 'live-browser',
    dir: path.join(root, 'packages', 'cli'),
    required: [
      'package/package.json',
      'package/README.md',
      'package/LICENSE',
      'package/dist/index.js',
      'package/dist/sdk.js',
      'package/skill/live-browser/SKILL.md',
      'package/skill/live-browser/agents/openai.yaml',
    ],
  },
];

export function bunCommand() {
  if (path.basename(process.execPath).toLowerCase().startsWith('bun')) {
    return process.execPath;
  }
  return process.platform === 'win32' ? 'bun.exe' : 'bun';
}

export function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function run(command, args, cwd = root, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: options.encoding ?? 'utf8',
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: options.stdio ?? 'pipe',
  });
}

export function packPackage(pkg, destination) {
  mkdirSync(destination, { recursive: true });
  const output = run(bunCommand(), ['pm', 'pack', '--quiet', '--destination', destination], pkg.dir).trim();
  const tarballPath = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line.endsWith('.tgz'));
  if (!tarballPath) {
    throw new Error(`Failed to pack ${pkg.name}.`);
  }

  return path.isAbsolute(tarballPath) ? tarballPath : path.join(destination, tarballPath);
}
