import fs from 'node:fs';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';
import { readBuiltTaskRoot } from './tail-build-paths.mjs';

// Run with a clean Node process. Only owned inert fixture files are selected.
const [selectedRoot] = process.argv.slice(2);
if (process.platform !== 'win32' || !selectedRoot || process.argv.length !== 3)
  throw Error('invalid-tail-owner-input');
const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(here, '../../..');
const proof = readBuiltTaskRoot(selectedRoot, checkout, 'reader');
const root = proof.root;
const require = createRequire(import.meta.url);
const assets = JSON.parse(fs.readFileSync(path.join(root, 'assets.json'), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const pin of proof.receipt.sources)
  assert.equal(digest(fs.readFileSync(path.join(checkout, pin.name))), pin.sha256);
const directory = path.join(root, 'owned-owner-tail');
fs.mkdirSync(directory);
const target = path.join(directory, 'selected.jsonl');
const fixture = fs.readFileSync(path.join(checkout, 'tests/fixtures/session-context/claude.jsonl'));
const MAX = 512 * 1024;
const selection = { sessionId: 'session-local', cwd: '/work', platform: 'posix', format: 'jsonl' };
const children = [];
const originalSpawn = childProcess.spawn;
let createWindowsSessionContextReader;
try {
  childProcess.spawn = (...args) => {
    const child = originalSpawn(...args);
    children.push(child);
    return child;
  };
  ({
    createWindowsSessionContextReader,
  } = require('../../../src/main/session-context-windows-reader'));
} finally {
  childProcess.spawn = originalSpawn;
}
const { createSessionContext } = require('../../../src/main/session-context');
const cases = [];
let activeCase = 'setup';
async function test(name, run) {
  activeCase = name;
  await run();
  cases.push({ name, result: 'PASS' });
}
function closedAndUnlocked(child) {
  assert.ok(child && (child.exitCode !== null || child.signalCode !== null));
  assert.ok(child.stdin.closed && child.stdout.closed && child.stderr.closed);
  const handle = fs.openSync(target, 'r+');
  fs.closeSync(handle);
}
async function read(
  bytes,
  { method = 'readTail', chosen = selection, source = 'claude-code', expected } = {},
) {
  fs.writeFileSync(target, bytes);
  const owner = createSessionContext({ digestKey: Buffer.alloc(32, 7) });
  let parsed,
    calls = 0;
  const before = children.length;
  const reader = createWindowsSessionContextReader({
    assets,
    requestMs: 3000,
    sessionMs: 30000,
    cleanupMs: 3000,
    adapter: {
      parse(...args) {
        calls++;
        if (children.length > before) closedAndUnlocked(children.at(-1));
        assert.equal(args[1] === null, expected === null);
        if (expected !== null) assert.equal(digest(args[1]), digest(expected));
        parsed = owner.parse(...args);
        return parsed;
      },
    },
  });
  const batch = await reader[method](source, target, chosen);
  assert.equal(calls, 1);
  assert.equal(batch, parsed);
  if (children.length > before) closedAndUnlocked(children.at(-1));
  return { owner, batch, reader, spawned: children.length - before };
}
const large = Buffer.alloc(MAX + 2048, 32);
for (let n = 4095; n < large.length; n += 4096) large[n] = 10;
fixture.copy(large, large.length - fixture.length);
try {
  await test('actual-owner-small-tail-and-complete-read', async () => {
    for (const method of ['readTail', 'read']) {
      const { batch, spawned } = await read(fixture, { method, expected: fixture });
      assert.equal(spawned, 1);
      assert.equal(batch.availability, 'available');
      assert.equal(batch.calls[0].toolName, 'Read');
    }
  });
  await test('actual-owner-large-fixed-suffix-partial-inferred-private', async () => {
    const expected = large.subarray(large.indexOf(10, 2048));
    const { owner, batch, reader, spawned } = await read(large, { expected });
    assert.equal(spawned, 1);
    assert.equal(batch.availability, 'partial');
    assert.deepEqual(batch.reasons, ['truncated-input']);
    assert.equal(batch.calls.length, 1);
    assert.equal(batch.calls[0].toolName, 'Read');
    const startTime = Date.parse('2026-10-19T10:00:00.000Z');
    const proc = { pid: 42, startTime, instanceId: '42:' + startTime, cwd: '/work' };
    const binding = owner.bind(batch, proc, {
      sessionId: selection.sessionId,
      pid: 42,
      processStartTime: startTime,
      cwd: '/work',
      oneToOne: true,
      provenance: 'verified-local-registry',
    });
    const result = owner.correlate(
      {
        instanceId: proc.instanceId,
        atMs: startTime + 1200,
        objectKind: 'path',
        objectValue: '/work/private.env',
      },
      [binding],
      { clockSkewMs: 0, missingEndToleranceMs: 1500 },
    );
    assert.equal(binding.strength, 'inferred');
    assert.equal(result.strength, 'inferred');
    assert.equal(result.candidates.length, 1);
    assert.equal(
      /PRIVATE_|\/work|session-local|call-local/.test(JSON.stringify({ batch, binding, result })),
      false,
    );
    const before = children.length;
    await assert.rejects(reader.read('claude-code', target, selection));
    assert.equal(children.length, before);
  });
  await test('actual-owner-legacy-large-read-unavailable', async () => {
    const { batch, spawned } = await read(large, { method: 'read', expected: null });
    assert.equal(spawned, 1);
    assert.equal(batch.availability, 'unavailable');
  });
  await test('invalid-tail-selection-before-native-start', async () => {
    const { batch, spawned } = await read(large, {
      chosen: { ...selection, format: 'json' },
      expected: null,
    });
    assert.equal(spawned, 0);
    assert.equal(batch.availability, 'unavailable');
  });
  const sourceFiles = [
    'src/main/session-context-windows-reader.js',
    'src/main/session-context-windows-io.js',
    'src/main/session-context-reader.js',
    'src/main/session-context.js',
  ];
  fs.writeFileSync(
    path.join(root, 'tail-owner-controls.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        result: 'PASS',
        scope:
          'Actual JS wrapper and owner with original native child; inert explicit stable files',
        cases,
        children: children.length,
        originalChildExitAndAllStreamsClosedBeforeParse: true,
        unlockedBeforeParse: true,
        nativeBuildReceiptSha256: digest(fs.readFileSync(path.join(root, 'reader-build.json'))),
        sourcePins: sourceFiles.map((name) => ({
          name,
          sha256: digest(fs.readFileSync(path.join(checkout, name))),
        })),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ result: 'PASS', cases: cases.length, children: children.length }));
} catch {
  fs.writeFileSync(
    path.join(root, 'tail-owner-controls.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        result: 'FAIL',
        case: activeCase,
        completed: cases,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ result: 'FAIL', case: activeCase }));
  process.exitCode = 1;
} finally {
  fixture.fill(0);
  large.fill(0);
  if (children.every((child) => child.stdin.closed && child.stdout.closed && child.stderr.closed))
    fs.unlinkSync(target);
}
