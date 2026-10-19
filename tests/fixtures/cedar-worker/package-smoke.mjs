import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Disposable fixtures are removed on completion; retained receipts live outside Temp.
const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const require = createRequire(path.join(root, 'package.json'));
const { createPackage } = require('@electron/asar');
const tempRoot = path.resolve(os.tmpdir());
assert.equal(path.parse(tempRoot).root.toUpperCase(), 'X:\\');
const owned = await fs.mkdtemp(path.join(tempRoot, 'cedar-worker-asar-'));
const modules = [
  'cedar-worker-client',
  'cedar-worker-thread',
  'cedar-runtime',
  'cedar-schema',
  'execution-policy',
  'execution-binding',
  'action-policy',
];
// Package exports intentionally do not expose package.json; resolve the official Node entry.
const cedarNode = path.dirname(require.resolve('@cedar-policy/cedar-wasm/nodejs'));
const cedarRoot = path.dirname(cedarNode);
const electron = path.join(
  path.dirname(require.resolve('electron/package.json')),
  'dist/electron.exe',
);
const source = String.raw`
'use strict';
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const { createCedarWorkerClient } = require('./src/main/cedar-worker-client');
const missing = process.argv[2] === 'missing';
let cedarVersion = null;
try { cedarVersion = require('@cedar-policy/cedar-wasm/nodejs').getCedarVersion(); } catch (_) {}
let started = 0;
let exited = 0;
class TrackedWorker extends Worker {
  constructor(entry, options) {
    super(entry, options);
    started++;
    this.once('exit', () => { exited++; });
  }
}
const client = createCedarWorkerClient({ WorkerClass: TrackedWorker });
const action = { executable: process.execPath, cwd: process.cwd(), args: ['PRIVATE_PACKAGED_ARG'], env: { SECRET: 'PRIVATE_PACKAGED_VALUE' } };
const policy = (source) => ({ schemaVersion: 4, cedarSchema: 'aegis-execution-v1', policies: { selected: source } });
(async () => {
  const decisions = [];
  try {
    decisions.push(await client.evaluate(policy('permit(principal, action, resource);'), action));
    decisions.push(await client.evaluate(policy('forbid(principal, action, resource);'), action));
    const expected = missing ? [
      { decision: 'deny', reason: 'cedar-unavailable', policyIds: [] },
      { decision: 'deny', reason: 'cedar-unavailable', policyIds: [] },
    ] : [
      { decision: 'allow', reason: 'policy-allow', policyIds: ['selected'] },
      { decision: 'deny', reason: 'policy-deny', policyIds: ['selected'] },
    ];
    assert.deepEqual(decisions, expected);
    assert.equal(started, 2);
    assert.equal(exited, 2);
    assert.equal(cedarVersion, missing ? null : '4.13.0');
    console.log(JSON.stringify({ electron: process.versions.electron, node: process.versions.node, cedarVersion, decisions, started, exited, missing }));
  } finally { client.close(); }
})().catch(() => { console.error('packaged-worker-smoke-failed'); process.exitCode = 1; });
`;
const copy = async (from, to) => {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
};
try {
  const receipts = [];
  for (const missing of [false, true]) {
    const fixture = path.join(owned, missing ? 'missing' : 'complete');
    await fs.mkdir(fixture);
    for (const name of modules)
      await copy(
        path.join(root, 'src/main', name + '.js'),
        path.join(fixture, 'src/main', name + '.js'),
      );
    for (const filename of [
      'package.json',
      'nodejs/package.json',
      'nodejs/cedar_wasm.js',
      ...(missing ? [] : ['nodejs/cedar_wasm_bg.wasm']),
    ])
      await copy(
        path.join(cedarRoot, filename),
        path.join(fixture, 'node_modules/@cedar-policy/cedar-wasm', filename),
      );
    await fs.writeFile(
      path.join(fixture, 'package.json'),
      JSON.stringify({ name: 'cedar-worker-asar-fixture', private: true, main: 'smoke.cjs' }),
    );
    await fs.writeFile(path.join(fixture, 'smoke.cjs'), source);
    const archive = fixture + '.asar';
    await createPackage(fixture, archive);
    const archiveBytes = (await fs.stat(archive)).size;
    assert.ok(archiveBytes < 16 * 1024 * 1024);
    const { stdout, stderr } = await promisify(execFile)(
      electron,
      [archive + '/smoke.cjs', missing ? 'missing' : 'complete'],
      {
        cwd: owned,
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          SystemRoot: process.env.SystemRoot,
          TEMP: owned,
          TMP: owned,
        },
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 64 * 1024,
      },
    );
    assert.equal(stderr, '');
    const result = JSON.parse(stdout.trim());
    receipts.push({ archiveBytes, ...result });
  }
  console.log(JSON.stringify({ scope: 'Electron embedded Node and ASAR loading only', receipts }));
} finally {
  const resolved = await fs.realpath(owned);
  assert.ok(resolved.startsWith(tempRoot + path.sep));
  assert.ok(path.basename(resolved).startsWith('cedar-worker-asar-'));
  assert.equal((await fs.lstat(owned)).isSymbolicLink(), false);
  await fs.rm(resolved, { recursive: true });
}
