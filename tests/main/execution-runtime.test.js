import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { isExecutionRuntimeSupported } = require('../../src/main/execution-runtime');
const originals = new Map();
function property(name, value) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(process, name));
  Object.defineProperty(process, name, { value, configurable: true });
}
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(process, name, descriptor);
    else delete process[name];
  }
  originals.clear();
});

it.each(['win32', 'linux', 'darwin'])(
  'accepts supported platform %s without restrictions',
  (platform) => {
    property('platform', platform);
    property('permission', undefined);
    expect(isExecutionRuntimeSupported()).toBe(true);
  },
);

it.each(['freebsd', 'aix', 'unknown'])('rejects unsupported platform %s', (platform) => {
  property('platform', platform);
  property('permission', undefined);
  expect(isExecutionRuntimeSupported()).toBe(false);
});

it('rejects permission-restricted Node even on a supported platform', () => {
  property('platform', 'win32');
  property('permission', { has: () => true });
  expect(isExecutionRuntimeSupported()).toBe(false);
});

it.each([false, true])('uses cached Node diagnostic state initially enabled=%s', (enabled) => {
  const modulePath = require.resolve('../../src/main/execution-runtime');
  const source = `
    const { isExecutionRuntimeSupported: check } = require(${JSON.stringify(modulePath)});
    const first = check();
    if (${enabled}) delete process.env.NODE_DEBUG;
    else process.env.NODE_DEBUG = 'child_process';
    process.stdout.write(JSON.stringify([first, check()]));
  `;
  const env = {};
  for (const name of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  if (enabled) env.NODE_DEBUG = 'child_process';
  const child = spawnSync(process.execPath, ['-e', source], {
    env,
    windowsHide: true,
    timeout: 3000,
    maxBuffer: 4096,
    encoding: 'utf8',
  });
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(child.stderr).toBe('');
  expect(JSON.parse(child.stdout)).toEqual([!enabled, !enabled]);
});
