import { rmSync } from 'node:fs';

for (const path of ['packages/core/dist', 'packages/sdk/dist', 'packages/cli/dist']) {
  rmSync(path, { force: true, recursive: true });
}
