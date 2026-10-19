import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import childProcess from 'node:child_process';

const require = createRequire(import.meta.url);
const report = 'X:/tmp/aegis-ten-hour-20261019/reports/05-windows-context-reader';
const assets = JSON.parse(fs.readFileSync(`${report}/assets.json`, 'utf8'));
const root = path.win32.normalize(`${report}/owned-controls`);
fs.mkdirSync(root, { recursive: true });
const selected = path.win32.join(root, 'selected.jsonl');
const selection = { sessionId: 'session-local', cwd: '/work', platform: 'posix' };
const children = [];
const originalSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = originalSpawn(...args);
  children.push(child);
  return child;
};
const {
  createWindowsSessionContextReader,
} = require('../../../src/main/session-context-windows-reader');
const { createWindowsSessionContextIO } = require('../../../src/main/session-context-windows-io');
const { createSessionContext } = require('../../../src/main/session-context');
const limits = { assets, requestMs: 3000, sessionMs: 30000, cleanupMs: 3000 };
const rows = [];
const fixture = (name) => fs.readFileSync(`tests/fixtures/session-context/${name}.jsonl`);

function closed(from) {
  for (const child of children.slice(from)) {
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'original-child-not-exited');
    assert.ok(
      child.stdin.closed && child.stdout.closed && child.stderr.closed,
      'stream-not-closed',
    );
  }
}
function write(bytes) {
  fs.writeFileSync(selected, bytes);
}
async function read(source, expectedRaw, extra = {}) {
  const from = children.length;
  const owner = createSessionContext({ digestKey: Buffer.alloc(32, 7) });
  let parsed = 0,
    result;
  const reader = createWindowsSessionContextReader({
    ...limits,
    adapter: {
      parse(kind, raw, selectedSession) {
        closed(from);
        if (fs.existsSync(selected)) {
          const unlocked = fs.openSync(selected, 'r+');
          fs.closeSync(unlocked);
        }
        assert.equal(raw === null ? null : raw.length, expectedRaw);
        parsed++;
        result = owner.parse(kind, raw, selectedSession);
        return result;
      },
    },
  });
  const returned = await reader.read(source, selected, { ...selection, ...extra });
  closed(from);
  assert.equal(parsed, 1);
  assert.equal(returned, result);
  assert.ok(!JSON.stringify(returned).includes('PRIVATE_'));
  // Invalid process evidence preserves this owner's batch ownership without
  // asserting authenticated provenance or confirmed correlation.
  const binding = owner.bind(returned, {}, {});
  assert.ok(
    !binding.evidence.includes('source-unavailable') || returned.availability !== 'available',
  );
  return returned;
}
async function test(name, action) {
  const from = children.length;
  try {
    await action();
    closed(from);
    rows.push({ name, result: 'PASS' });
  } catch (error) {
    closed(from); // Stop immediately for any unexpected child cleanup outcome.
    rows.push({ name, result: 'FAIL' });
    fs.writeFileSync(`${report}/native-controls.json`, JSON.stringify(rows, null, 2));
    throw error;
  }
}

try {
  for (const [source, name, tool] of [
    ['claude-code', 'claude', 'Read'],
    ['codex', 'codex', 'exec_command'],
    ['gemini-cli', 'gemini', 'read_file'],
  ]) {
    await test(`complete-${name}-existing-parser`, async () => {
      const bytes = fixture(name);
      write(bytes);
      const result = await read(source, bytes.length);
      assert.equal(result.availability, 'available');
      assert.equal(result.calls[0].toolName, tool);
    });
  }
  await test('missing-pre-open-close-before-null-parse', async () => {
    fs.unlinkSync(selected);
    assert.equal((await read('claude-code', null)).availability, 'unavailable');
  });
  await test('empty-complete-file-eof', async () => {
    write(Buffer.alloc(0));
    assert.equal((await read('claude-code', 0)).availability, 'unavailable');
  });
  await test('exact-512k-complete-file', async () => {
    const bytes = Buffer.alloc(512 * 1024, 32);
    fixture('claude').copy(bytes);
    write(bytes);
    const result = await read('claude-code', bytes.length);
    const baseline = createSessionContext({ digestKey: Buffer.alloc(32, 7) }).parse(
      'claude-code',
      bytes,
      selection,
    );
    assert.equal(result.availability, baseline.availability);
  });
  await test('oversize-refusal-before-owner-bytes', async () => {
    write(Buffer.alloc(512 * 1024 + 1, 32));
    assert.equal((await read('claude-code', null)).availability, 'unavailable');
  });
  await test('invalid-utf8-existing-parser', async () => {
    write(Buffer.from([255]));
    assert.equal((await read('claude-code', 1)).availability, 'unavailable');
  });
  await test('truncated-json-existing-parser', async () => {
    write(Buffer.from('{"type":'));
    assert.equal((await read('claude-code', 8)).availability, 'unavailable');
  });
  await test('explicit-truncation-no-launch', async () => {
    const before = children.length;
    assert.equal(
      (await read('claude-code', null, { headTruncated: true })).availability,
      'unavailable',
    );
    assert.equal(children.length, before);
  });
  await test('selection-mismatch-existing-parser', async () => {
    const bytes = fixture('claude');
    write(bytes);
    assert.equal(
      (await read('claude-code', bytes.length, { sessionId: 'different' })).availability,
      'unavailable',
    );
  });
  await test('active-owned-writer-contention-refused-writer-retained', async () => {
    write(fixture('claude'));
    const writer = fs.openSync(selected, 'r+');
    try {
      assert.equal((await read('claude-code', null)).availability, 'unavailable');
      assert.ok(fs.fstatSync(writer).isFile());
    } finally {
      fs.closeSync(writer);
    }
  });
  await test('held-id-full-stamp-and-100ns-epoch', async () => {
    write(fixture('claude'));
    const io = createWindowsSessionContextIO(limits);
    try {
      const first = await io.files.statPath(selected);
      const native = fs.statSync(selected, { bigint: true });
      assert.equal(first.mtimeNs, (native.mtimeNs + 11644473600000000000n).toString());
      assert.match(first.fileId, /^[a-f0-9]{32}$/);
      const handle = await io.files.openRead(selected);
      assert.deepEqual(await handle.stat(), first);
      const bytes = Buffer.alloc(first.size),
        probe = Buffer.alloc(1);
      assert.equal(await handle.read(bytes, 0, bytes.length, 0), bytes.length);
      assert.equal(await handle.read(probe, 0, 1, bytes.length), 0);
      assert.deepEqual(await handle.stat(), first);
      assert.deepEqual(await io.files.statPath(selected), first);
      await handle.close();
    } finally {
      await io.close();
    }
  });
  await test('held-file-writer-replacement-and-parent-rename-blocked', async () => {
    write(fixture('claude'));
    const replacement = path.win32.join(root, 'replacement.jsonl');
    fs.copyFileSync(selected, replacement);
    const io = createWindowsSessionContextIO(limits);
    try {
      await io.files.statPath(selected);
      assert.throws(() => fs.openSync(selected, 'r+'));
      assert.throws(() => fs.renameSync(replacement, selected));
      assert.throws(() => fs.renameSync(root, `${root}-moved`));
    } finally {
      await io.close();
      fs.unlinkSync(replacement);
    }
  });
  await test('mtime-update-during-held-read-blocked-or-version-refused', async () => {
    const bytes = fixture('claude');
    write(bytes);
    const io = createWindowsSessionContextIO(limits);
    try {
      const first = await io.files.statPath(selected);
      const handle = await io.files.openRead(selected);
      await handle.stat();
      let mutated = false;
      try {
        fs.utimesSync(selected, new Date(), new Date('2020-01-01T00:00:00Z'));
        mutated = true;
      } catch {
        /* Sharing exclusion is an allowed stable-file outcome. */
      }
      if (mutated)
        await assert.rejects(() => handle.read(Buffer.alloc(bytes.length), 0, bytes.length, 0));
      else assert.equal(first.size, bytes.length);
    } finally {
      await io.close();
    }
  });
  await test('same-content-mtime-updates-keep-native-change-witness', async () => {
    const bytes = fixture('claude');
    write(bytes);
    const firstIO = createWindowsSessionContextIO(limits);
    const first = await firstIO.files.statPath(selected);
    await firstIO.close();
    const before = fs.statSync(selected);
    fs.utimesSync(selected, before.atime, new Date('2020-01-01T00:00:00Z'));
    fs.utimesSync(selected, before.atime, before.mtime);
    const secondIO = createWindowsSessionContextIO(limits);
    try {
      const second = await secondIO.files.statPath(selected);
      assert.equal(second.fileId, first.fileId);
      assert.notEqual(second.ctimeNs, first.ctimeNs);
    } finally {
      await secondIO.close();
    }
  });
  await test('hardlink-refused', async () => {
    write(fixture('claude'));
    const alias = path.win32.join(root, 'hardlink.jsonl');
    fs.linkSync(selected, alias);
    try {
      assert.equal((await read('claude-code', null)).availability, 'unavailable');
    } finally {
      fs.unlinkSync(alias);
    }
  });
  await test('reparse-ancestor-junction-refused', async () => {
    write(fixture('claude'));
    const alias = `${root}-junction`;
    fs.symlinkSync(root, alias, 'junction');
    const io = createWindowsSessionContextIO(limits);
    try {
      await assert.rejects(() => io.files.statPath(path.win32.join(alias, 'selected.jsonl')));
    } finally {
      await io.close();
      fs.rmdirSync(alias);
    }
  });
  let linkCreated = false;
  const link = path.win32.join(root, 'symbolic.jsonl');
  try {
    fs.symlinkSync(selected, link, 'file');
    linkCreated = true;
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    rows.push({
      name: 'file-symlink-refused',
      result: 'NOTRUN',
      reason: 'creation-privilege-unavailable',
    });
  }
  if (linkCreated)
    await test('file-symlink-refused', async () => {
      const io = createWindowsSessionContextIO(limits);
      try {
        await assert.rejects(() => io.files.statPath(link));
      } finally {
        await io.close();
        fs.unlinkSync(link);
      }
    });
  fs.writeFileSync(`${report}/native-controls.json`, JSON.stringify(rows, null, 2));
  console.log(
    JSON.stringify({
      nativeCases: rows.length,
      passed: rows.filter((row) => row.result === 'PASS').length,
      notRun: rows.filter((row) => row.result === 'NOTRUN').length,
      children: children.length,
      originalChildExitAndStreams: 'confirmed',
      parserAfterClosure: true,
    }),
  );
} finally {
  childProcess.spawn = originalSpawn;
  if (fs.existsSync(selected)) fs.unlinkSync(selected);
}
