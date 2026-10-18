import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import config from '../../vitest.config.js';

const require = createRequire(import.meta.url);
const repository = fileURLToPath(new URL('../../', import.meta.url));
const cli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const fixtures = [];

afterEach(() => {
  for (const folder of fixtures.splice(0)) {
    // These plain directories were created by this test, directly under its temp root.
    expect(path.dirname(path.resolve(folder))).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(folder).isSymbolicLink()).toBe(false);
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

function fixture({ ready = false, mode = 'ready', override = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis electron prep-'));
  fixtures.push(root);
  const electron = path.join(root, 'node_modules/electron');
  fs.mkdirSync(electron, { recursive: true });
  fs.mkdirSync(path.join(root, 'cases'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  fs.writeFileSync(
    path.join(electron, 'package.json'),
    JSON.stringify({ name: 'electron', version: '1.2.3', main: 'index.js' }),
  );
  const dist = path.join(electron, 'dist');
  const binaryRoot = override ? path.join(root, 'custom runtime') : dist;
  const binary = path.join(binaryRoot, 'fixture-electron');
  const events = path.join(root, 'events.jsonl');
  const record = `const record = (event) => fs.appendFileSync(${JSON.stringify(events)}, JSON.stringify(event) + '\\n');`;
  const observeLoop = !ready && mode === 'ready';
  const heartbeat = path.join(root, 'heartbeat.mjs');
  if (observeLoop) {
    fs.writeFileSync(
      heartbeat,
      `import fs from 'node:fs';
${record}
export default function setup() {
  const timer = setInterval(() => record({ phase: 'setup-heartbeat' }), 20);
  return () => clearInterval(timer);
}`,
    );
  }
  fs.writeFileSync(
    path.join(electron, 'install.js'),
    `const fs = require('node:fs');
${record}
record({ phase: 'installer-check', cache: process.env.electron_config_cache, mirror: process.env.ELECTRON_MIRROR });
if (fs.existsSync(${JSON.stringify(binary)})) process.exit(0);
if (${JSON.stringify(mode)} === 'fail') { console.error('fixture download failed'); process.exit(17); }
if (${JSON.stringify(mode)} === 'noop') process.exit(0);
record({ phase: 'download-start' });
setTimeout(() => {
  fs.mkdirSync(${JSON.stringify(dist)}, { recursive: true });
  fs.mkdirSync(${JSON.stringify(binaryRoot)}, { recursive: true });
  fs.writeFileSync(${JSON.stringify(path.join(dist, 'version'))}, '1.2.3');
  fs.writeFileSync(${JSON.stringify(path.join(electron, 'path.txt'))}, 'fixture-electron');
  fs.writeFileSync(${JSON.stringify(binary)}, 'fixture');
  record({ phase: 'download-ready' });
}, 1200);
`,
  );
  fs.writeFileSync(
    path.join(electron, 'index.js'),
    `const fs = require('node:fs');
${record}
record({ phase: 'worker-require' });
if (!fs.existsSync(${JSON.stringify(binary)})) {
  record({ phase: 'worker-download' });
  require('node:child_process').execFileSync(process.execPath, [require.resolve('./install.js')]);
}
module.exports = ${JSON.stringify(binary)};
`,
  );
  if (ready) {
    fs.mkdirSync(dist, { recursive: true });
    fs.mkdirSync(binaryRoot, { recursive: true });
    fs.writeFileSync(path.join(dist, 'version'), '1.2.3');
    fs.writeFileSync(path.join(electron, 'path.txt'), 'fixture-electron');
    fs.writeFileSync(binary, 'fixture');
  }
  for (const name of ['one', 'two']) {
    fs.writeFileSync(
      path.join(root, `cases/${name}.test.mjs`),
      `import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
${record}
beforeEach(async () => {
  const executable = require('electron');
  if (!fs.statSync(executable).isFile()) throw new Error('Electron is not ready');
  await new Promise(resolve => setTimeout(resolve, 25));
});
it('uses the prepared binary', () => record({ phase: 'test' }));
`,
    );
  }
  const globalSetup = [config.test.globalSetup]
    .flat()
    .filter(Boolean)
    .map((file) => path.resolve(repository, file));
  if (observeLoop) globalSetup.unshift(heartbeat);
  fs.writeFileSync(
    path.join(root, 'vitest.config.mjs'),
    `export default ${JSON.stringify({
      root,
      test: {
        globalSetup,
        globals: true,
        hookTimeout: 200,
        maxWorkers: 2,
        projects: ['one', 'two'].map((name) => ({
          test: { name, include: [`cases/${name}.test.mjs`] },
        })),
      },
    })};`,
  );
  // Windows child environments keep only the first case-insensitive key.
  // Vitest can expose uppercase npm aliases; remove them before fixture overrides.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !['electron_config_cache', 'electron_mirror', 'electron_override_dist_path'].includes(
          key.toLowerCase(),
        ),
    ),
  );
  Object.assign(env, {
    electron_config_cache: path.join(root, 'cache'),
    ELECTRON_MIRROR: 'https://fixture.invalid/electron/',
    ELECTRON_OVERRIDE_DIST_PATH: override ? binaryRoot : '',
  });
  const result = spawnSync(
    process.execPath,
    [cli, 'run', '--config', path.join(root, 'vitest.config.mjs')],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      env,
    },
  );
  return {
    ...result,
    output: `${result.stdout}\n${result.stderr}`,
    events: fs.existsSync(events)
      ? fs
          .readFileSync(events, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [],
    root,
  };
}

describe('Electron preparation before test workers', () => {
  it('prepares a cold binary once across projects before timed hooks can import Electron', () => {
    const result = fixture();
    expect(result.error).toBeUndefined();
    expect(result.status, result.output).toBe(0);
    const phases = result.events.map((event) => event.phase);
    expect(phases.filter((phase) => phase === 'installer-check')).toHaveLength(1);
    expect(phases.filter((phase) => phase === 'download-start')).toHaveLength(1);
    expect(phases).not.toContain('worker-download');
    expect(phases.indexOf('download-ready')).toBeLessThan(phases.indexOf('worker-require'));
    const downloading = phases.slice(
      phases.indexOf('download-start') + 1,
      phases.indexOf('download-ready'),
    );
    expect(downloading).toContain('setup-heartbeat');
    expect(phases.filter((phase) => phase === 'test')).toHaveLength(2);
    expect(result.events.find((event) => event.phase === 'installer-check')).toMatchObject({
      cache: path.join(result.root, 'cache'),
      mirror: 'https://fixture.invalid/electron/',
    });
  }, 15000);

  it('reuses a ready binary without downloading, including an explicit distribution override', () => {
    const result = fixture({ ready: true, override: true });
    expect(result.status, result.output).toBe(0);
    expect(result.events.filter((event) => event.phase === 'installer-check')).toHaveLength(1);
    expect(result.events.some((event) => event.phase.includes('download'))).toBe(false);
    expect(result.events.filter((event) => event.phase === 'test')).toHaveLength(2);
  }, 15000);

  it('fails preparation once and starts no workers when installation fails', () => {
    const result = fixture({ mode: 'fail' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.output).toContain('fixture download failed');
    expect(result.output).toContain('Electron preparation failed before test workers started');
    expect(result.events.map((event) => event.phase)).toEqual(['installer-check']);
  }, 15000);

  it('starts no workers when an installer exits successfully without a ready binary', () => {
    const result = fixture({ mode: 'noop' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.output).toContain('Electron preparation failed before test workers started');
    expect(result.events.map((event) => event.phase)).toEqual(['installer-check']);
  }, 15000);
});
