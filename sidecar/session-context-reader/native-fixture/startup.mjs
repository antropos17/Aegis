import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root = path.resolve('sidecar/session-context-reader/native-fixture');
const baseEnv = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot };
const run = (env) => {
  const result = spawnSync(process.execPath, [`${root}/preflight.cjs`], {
    env: { ...baseEnv, ...env },
    windowsHide: true,
    timeout: 3000,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  return result.stdout;
};
assert.equal(run({}), 'allowed');
assert.equal(run({ NODE_OPTIONS: `--require=${root}/preload.cjs` }), 'refused');
for (const key of [
  'NODE_DEBUG',
  'NODE_DEBUG_NATIVE',
  'DOTNET_STARTUP_HOOKS',
  'COREHOST_TRACE',
  'DOTNET_HOST_TRACE',
])
  assert.equal(run({ [key]: 'private-control' }), 'refused');
const cachedImport = run({ NODE_OPTIONS: `--import=${pathToFileURL(`${root}/preload.cjs`).href}` });
console.log(
  JSON.stringify({
    startupControls: 7,
    result: 'PASS',
    cachedRequireAfterEnvDeletion: 'refused',
    cachedImportAfterEnvDeletion: cachedImport,
    startupProvenance: 'trusted-embedding-required-no-process-authentication',
  }),
);
