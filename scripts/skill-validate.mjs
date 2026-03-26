import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const target = path.join(root, '.agents', 'skills', 'live-browser');

for (const candidate of commandCandidates()) {
  try {
    execFileSync(candidate.command, [...candidate.args, 'validate', target], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    process.exit(0);
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 0) {
      process.exit(0);
    }
  }
}

throw new Error(
  'Unable to find the Agent Skills validator. Install skills-ref and ensure the agentskills CLI is available, or provide a Python install under LocalAppData.',
);

function commandCandidates() {
  const candidates = [{ command: 'agentskills', args: [] }];
  const localPythonRoot = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python');
  if (existsSync(localPythonRoot)) {
    const versions = ['Python312', 'Python313', 'Python311'];
    for (const version of versions) {
      const executable = path.join(localPythonRoot, version, 'Scripts', 'agentskills.exe');
      if (existsSync(executable)) {
        candidates.push({ command: executable, args: [] });
      }
      const pythonExe = path.join(localPythonRoot, version, 'python.exe');
      if (existsSync(pythonExe)) {
        candidates.push({ command: pythonExe, args: ['-m', 'agentskills'] });
      }
    }
  }

  return candidates;
}
