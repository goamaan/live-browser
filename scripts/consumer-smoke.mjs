import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bunCommand, npmCommand, packPackage, publicPackages, run } from './package-utils.mjs';

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'live-browser-consumer-'));
const tarballDir = path.join(tmpDir, 'tarballs');
const bunProjectDir = path.join(tmpDir, 'bun-project');
const npmProjectDir = path.join(tmpDir, 'npm-project');

try {
  run(bunCommand(), ['run', 'build']);

  const tarballs = publicPackages.map((pkg) => ({
    name: pkg.name,
    file: packPackage(pkg, tarballDir),
  }));

  smokeBunInstall(tarballs);
  smokeNpmInstall(tarballs);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

function smokeBunInstall(tarballs) {
  const cliTarball = getTarball(tarballs, 'live-browser');
  const cliDependency = toFileDependency(bunProjectDir, cliTarball);

  writeProjectManifest(bunProjectDir, 'consumer-bun-smoke', {
    'live-browser': cliDependency,
  });

  run(bunCommand(), ['install'], bunProjectDir, { stdio: 'inherit' });
  const helpOutput = run(bunCommand(), ['x', 'live-browser', '--help'], bunProjectDir);
  assert.match(helpOutput, /Usage: live-browser/);

  const skillBase = path.join(bunProjectDir, 'skill-output');
  run(bunCommand(), ['x', 'live-browser', 'skill', 'install', '--project', skillBase], bunProjectDir, { stdio: 'inherit' });
  assert.ok(existsSync(path.join(skillBase, '.agents', 'skills', 'live-browser', 'SKILL.md')));
}

function smokeNpmInstall(tarballs) {
  const cliTarball = getTarball(tarballs, 'live-browser');
  const cliDependency = toFileDependency(npmProjectDir, cliTarball);

  writeProjectManifest(npmProjectDir, 'consumer-npm-smoke', {
    'live-browser': cliDependency,
  });

  run(npmCommand(), ['install'], npmProjectDir, { stdio: 'inherit' });
  const helpOutput = run(npmCommand(), ['exec', '--', 'live-browser', '--help'], npmProjectDir);
  assert.match(helpOutput, /Usage: live-browser/);

  const skillBase = path.join(npmProjectDir, 'skill-output');
  run(npmCommand(), ['exec', '--', 'live-browser', 'skill', 'install', '--project', skillBase], npmProjectDir, {
    stdio: 'inherit',
  });
  assert.ok(existsSync(path.join(skillBase, '.agents', 'skills', 'live-browser', 'SKILL.md')));
}

function writeProjectManifest(directory, name, dependencies = {}) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify(
      {
        name,
        private: true,
        dependencies,
      },
      null,
      2,
    ),
  );
}

function getTarball(tarballs, packageName) {
  const match = tarballs.find((tarball) => tarball.name === packageName);
  if (!match) {
    throw new Error(`Missing tarball for ${packageName}.`);
  }

  return match.file;
}

function toFileDependency(projectDir, filePath) {
  const relativePath = path.relative(projectDir, filePath).split(path.sep).join('/');
  return `file:${relativePath}`;
}
