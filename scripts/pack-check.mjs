import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packPackage, publicPackages, run } from './package-utils.mjs';

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'live-browser-pack-'));

try {
  for (const pkg of publicPackages) {
    const tarball = packPackage(pkg, tmpDir);
    const entries = new Set(run('tar', ['-tf', tarball]).trim().split(/\r?\n/));
    for (const required of pkg.required) {
      if (!entries.has(required)) {
        throw new Error(`Missing ${required} in ${pkg.name} package archive.`);
      }
    }

    const manifest = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json']));
    if (JSON.stringify(manifest).includes('workspace:')) {
      throw new Error(`${pkg.name} archive still contains workspace protocol ranges.`);
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
