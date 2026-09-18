import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'out/development');
fs.mkdirSync(out, { recursive: true });
const localPath = path.join(root, 'tools/development/local.json');
const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')) : {};
const command = process.env.AEGIS_SEMGREP || local.semgrep || 'semgrep';
const result = spawnSync(
  command,
  [
    'scan',
    '--config',
    'tools/development/security-rules.yml',
    '--metrics=off',
    '--disable-version-check',
    '--error',
    '--strict',
    '--jobs=2',
    '--timeout=10',
    '--json',
    '--output',
    'out/development/security.json',
    'src/main',
    'src/shared',
    'frontend/observatory/runtime',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      SEMGREP_SEND_METRICS: 'off',
      SEMGREP_ENABLE_VERSION_CHECK: '0',
      SEMGREP_LOG_FILE: path.join(out, 'semgrep.log'),
    },
  },
);
if (result.error)
  console.error(`Semgrep unavailable: ${result.error.message}. See docs/development/workflow.md.`);
process.exitCode = result.status ?? 2;
