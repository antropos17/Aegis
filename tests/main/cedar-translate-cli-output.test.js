import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cli = require('../../scripts/translate-execution-policy.cjs');
const { readActionFile } = require('../../src/main/action-policy');
const { translateSchema2Policy } = require('../../src/main/cedar-translator');
let root;
let input;
let policy;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cedar-writer-'));
  input = path.join(root, 'source.json');
  policy = { schemaVersion: 2, defaultDecision: 'deny', rules: [{ action: { executable: process.execPath, cwd: root, args: ['PRIVATE_WRITER_ARGUMENT'], env: {} }, decision: 'allow' }] };
  fs.writeFileSync(input, JSON.stringify(policy));
});
afterEach(() => {
  cli._resetForTest();
  for (const name of fs.readdirSync(root)) {
    const filename = path.join(root, name);
    const stat = fs.lstatSync(filename);
    if (stat.isDirectory() && !stat.isSymbolicLink()) throw Error('unexpected-fixture-directory');
    try { fs.unlinkSync(filename); } catch (error) { if (stat.isSymbolicLink() && process.platform === 'win32') fs.rmdirSync(filename); else throw error; }
  }
  fs.rmdirSync(root);
});
function outputIO(hooks = {}) {
  const calls = { open: 0, write: 0, sync: 0, close: 0, readBack: 0, unlink: 0 };
  const buffers = [];
  const readbacks = [];
  const io = {
    async open(filename, flags, mode) {
      calls.open++;
      assert.ok(flags & fs.constants.O_EXCL);
      assert.ok(flags & fs.constants.O_CREAT);
      assert.equal(mode, 0o600);
      const handle = await fs.promises.open(filename, flags, mode);
      if (hooks.open) return hooks.open(handle, filename);
      return {
        stat: () => hooks.stat ? hooks.stat(handle) : handle.stat(),
        async write(...args) { calls.write++; buffers.push(args[0]); return hooks.write ? hooks.write(handle, ...args) : handle.write(...args); },
        async sync() { calls.sync++; return hooks.sync ? hooks.sync(handle) : handle.sync(); },
        async close() { calls.close++; return hooks.close ? hooks.close(handle, filename) : handle.close(); },
      };
    },
    async readBack(filename) {
      calls.readBack++;
      const bytes = hooks.readBack ? await hooks.readBack(filename) : await readActionFile(filename);
      readbacks.push(bytes);
      return bytes;
    },
    async unlink() { calls.unlink++; throw Error('UNEXPECTED_UNLINK'); },
  };
  return { io, calls, buffers, readbacks };
}
function assertSanitized(result) {
  assert.equal(result.result.evaluated, false);
  assert.equal(result.result.activated, false);
  for (const secret of [root, 'PRIVATE_WRITER_ARGUMENT', 'PRIVATE_FAULT']) assert.equal(JSON.stringify(result).includes(secret), false);
}

describe('exclusive export writer fault boundaries', () => {
  it('refuses an empty foreign destination appearing immediately before the exclusive open', async () => {
    const output = path.join(root, 'racing-empty.json');
    let opens = 0;
    let unlinks = 0;
    cli._setDepsForTest({ outputIO: {
      async open(filename, flags, mode) {
        opens++;
        fs.writeFileSync(filename, Buffer.alloc(0), { flag: 'wx' });
        return fs.promises.open(filename, flags, mode);
      },
      async unlink() { unlinks++; throw Error('UNEXPECTED_UNLINK'); },
    } });
    const result = await cli.exportSelectedPolicy([input, output]);
    assert.equal(result.code, 2);
    assert.equal(result.result.reason, 'destination-unavailable');
    assert.equal(opens, 1);
    assert.equal(unlinks, 0);
    assert.equal(fs.statSync(output).size, 0);
    assertSanitized(result);
  });

  it('writes through positive short writes, confirms close/readback and clears available buffers', async () => {
    const output = path.join(root, 'partial-writes.json');
    const state = outputIO({ write(handle, buffer, offset, length, position) { return handle.write(buffer, offset, Math.min(length, 71), position); } });
    cli._setDepsForTest({ outputIO: state.io });
    const result = await cli.exportSelectedPolicy([input, output]);
    assert.equal(result.code, 0);
    assert.equal(result.result.status, 'exported');
    assert.ok(state.calls.write > 1);
    assert.equal(state.calls.sync, 1);
    assert.equal(state.calls.close, 1);
    assert.equal(state.calls.readBack, 1);
    assert.equal(state.calls.unlink, 0);
    for (const buffer of [...state.buffers, ...state.readbacks]) assert.equal(buffer.every((byte) => byte === 0), true);
    assert.equal(JSON.parse(fs.readFileSync(output)).schemaVersion, 4);
    if (process.platform !== 'win32') assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assertSanitized(result);
  });

  it('retains failed or unconfirmed output for write/sync/close/readback failures without unlink or close retry', async () => {
    const faults = [
      ['write-throw', { async write(handle, buffer, offset, length, position) { await handle.write(buffer, offset, Math.min(length, 7), position); throw Error('PRIVATE_FAULT'); } }],
      ['write-zero', { write() { return { bytesWritten: 0 }; } }],
      ['sync', { sync() { throw Error('PRIVATE_FAULT'); } }],
      ['close', { async close(handle) { await handle.close(); throw Error('PRIVATE_FAULT'); } }],
      ['read-failure', { readBack() { throw Error('PRIVATE_FAULT'); } }],
      ['read-mismatch', { async readBack(filename) { const bytes = await readActionFile(filename); bytes[0] ^= 1; return bytes; } }],
      ['stat-size', { async stat(handle) { const stat = await handle.stat(); return Object.assign(stat, { size: stat.size + 1 }); } }],
    ];
    const source = fs.readFileSync(input);
    for (const [name, hooks] of faults) {
      const output = path.join(root, name + '.json');
      const state = outputIO(hooks);
      cli._setDepsForTest({ outputIO: state.io });
      const result = await cli.exportSelectedPolicy([input, output]);
      assert.deepEqual(result, { code: 3, result: { status: 'unconfirmed-output', reason: 'output-unconfirmed', evaluated: false, activated: false } });
      assert.equal(fs.existsSync(output), true);
      assert.ok(fs.statSync(output).size <= 65536);
      assert.equal(state.calls.close, 1);
      assert.equal(state.calls.unlink, 0);
      if (name === 'close') assert.equal(state.calls.readBack, 0);
      for (const buffer of [...state.buffers, ...state.readbacks]) assert.equal(buffer.every((byte) => byte === 0), true);
      assert.deepEqual(fs.readFileSync(input), source);
      assertSanitized(result);
    }
  });

  it('reports uncertain creation without deleting a file created before an open error', async () => {
    const output = path.join(root, 'uncertain-open.json');
    const state = outputIO({ async open(handle) { await handle.close(); throw Error('PRIVATE_FAULT'); } });
    cli._setDepsForTest({ outputIO: state.io });
    const result = await cli.exportSelectedPolicy([input, output]);
    assert.equal(result.code, 3);
    assert.equal(result.result.status, 'unconfirmed-output');
    assert.equal(fs.existsSync(output), true);
    assert.equal(state.calls.open, 1);
    assert.equal(state.calls.unlink, 0);
    assertSanitized(result);
  });

  it('binds readback to created identity and preserves a same-byte foreign replacement after close', async () => {
    const output = path.join(root, 'replaced-after-close.json');
    const retained = path.join(root, 'retained-original.json');
    let foreign;
    let originalIdentity;
    const state = outputIO({ async close(handle, filename) {
      originalIdentity = await handle.stat();
      await handle.close();
      foreign = fs.readFileSync(filename);
      fs.renameSync(filename, retained);
      fs.writeFileSync(filename, foreign, { flag: 'wx', mode: 0o600 });
    } });
    cli._setDepsForTest({ outputIO: state.io });
    const result = await cli.exportSelectedPolicy([input, output]);
    assert.equal(result.code, 3);
    assert.equal(result.result.status, 'unconfirmed-output');
    assert.notEqual(fs.statSync(output).ino, originalIdentity.ino);
    assert.deepEqual(fs.readFileSync(output), foreign);
    assert.deepEqual(fs.readFileSync(retained), foreign);
    assert.equal(state.calls.unlink, 0);
    assertSanitized(result);
  });

  it('refuses a path replacement after byte readback and preserves the foreign marker', async () => {
    const output = path.join(root, 'replaced-after-read.json');
    const retained = path.join(root, 'retained-read.json');
    const foreign = Buffer.from('FOREIGN_MARKER_MUST_REMAIN');
    const state = outputIO({ async readBack(filename) {
      const bytes = await readActionFile(filename);
      fs.renameSync(filename, retained);
      fs.writeFileSync(filename, foreign, { flag: 'wx', mode: 0o600 });
      return bytes;
    } });
    cli._setDepsForTest({ outputIO: state.io });
    const result = await cli.exportSelectedPolicy([input, output]);
    assert.equal(result.code, 3);
    assert.equal(result.result.status, 'unconfirmed-output');
    assert.deepEqual(fs.readFileSync(output), foreign);
    assert.equal(state.calls.unlink, 0);
    for (const bytes of state.readbacks) assert.equal(bytes.every((byte) => byte === 0), true);
    assertSanitized(result);
  });

  it('checks serialized output size before any destination open', async () => {
    policy.rules = Array.from({ length: 32 }, (_, index) => ({ action: { ...policy.rules[0].action, args: ['x'.repeat(1024) + index] }, decision: 'allow' }));
    assert.ok(Buffer.byteLength(JSON.stringify(policy)) < 65536);
    assert.ok(Buffer.byteLength(JSON.stringify(translateSchema2Policy(policy).policy) + '\n') > 65536);
    fs.writeFileSync(input, JSON.stringify(policy));
    const state = outputIO();
    cli._setDepsForTest({ outputIO: state.io });
    const output = path.join(root, 'oversized.json');
    const result = await cli.exportSelectedPolicy([input, output]);
    assert.equal(result.code, 2);
    assert.equal(result.result.reason, 'output-too-large');
    assert.equal(state.calls.open, 0);
    assert.equal(fs.existsSync(output), false);
    assertSanitized(result);
  });
});
