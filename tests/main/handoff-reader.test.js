import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { importHandoffEvents, LIMITS } = require('../../src/main/handoff-import');
let root;
let file;
const line =
  JSON.stringify({ hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a' }) + '\n';
const read = (name = file) => importHandoffEvents('claude-code', name);
const codes = (report) => report.diagnostics.map((d) => d.code);
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-handoff-reader-'));
  file = path.join(root, 'events.jsonl');
  fs.writeFileSync(file, line);
});
afterEach(() => {
  vi.restoreAllMocks();
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

it('reports missing and nonregular input without paths or filesystem exception text', async () => {
  const missing = await read(path.join(root, 'PRIVATE_MISSING'));
  expect(codes(missing)).toEqual(['input-unavailable']);
  expect(JSON.stringify(missing)).not.toContain('PRIVATE');
  expect(codes(await read(root))).toEqual(['input-not-regular']);
});

it.each(['\\\\host\\PRIVATE\\file', '//host/PRIVATE/file', 'PRIVATE:stream'])(
  'rejects unsupported path %s before opening',
  async (name) => {
    const open = vi.spyOn(fs.promises, 'open');
    expect(codes(await read(name))).toEqual(['input-path-unsupported']);
    expect(open).not.toHaveBeenCalled();
  },
);

it('rejects a real link/junction leaf before opening it', async () => {
  const link = path.join(root, 'link');
  // Junctions do not require Windows Developer Mode or symlink privileges.
  fs.symlinkSync(
    process.platform === 'win32' ? root : file,
    link,
    process.platform === 'win32' ? 'junction' : 'file',
  );
  try {
    const open = vi.spyOn(fs.promises, 'open');
    expect(codes(await read(link))).toEqual(['input-link-rejected']);
    expect(open).not.toHaveBeenCalled();
  } finally {
    // Remove the exact link before fixture cleanup; never recursively follow it.
    if (process.platform === 'win32') fs.rmdirSync(link);
    else fs.unlinkSync(link);
  }
});

it('checks opened identity before reading when a replacement wins the open race', async () => {
  const other = path.join(root, 'other.jsonl');
  fs.writeFileSync(other, line);
  const originalOpen = fs.promises.open.bind(fs.promises);
  let reading;
  vi.spyOn(fs.promises, 'open').mockImplementation(async () => {
    const handle = await originalOpen(other, 'r');
    reading = vi.spyOn(handle, 'read');
    return handle;
  });
  const report = await read();
  expect(codes(report)).toEqual(['input-changed']);
  expect(reading).not.toHaveBeenCalled();
  expect(report.events).toEqual([]);
});

it.each(['append', 'truncate', 'replace'])(
  'marks a visible %s during reading incomplete',
  async (change) => {
    const originalOpen = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      const originalRead = handle.read.bind(handle);
      vi.spyOn(handle, 'read').mockImplementation(async (...readArgs) => {
        const result = await originalRead(...readArgs);
        if (change === 'append') fs.appendFileSync(file, line);
        if (change === 'truncate') fs.truncateSync(file, 0);
        if (change === 'replace') {
          fs.renameSync(file, path.join(root, 'previous.jsonl'));
          fs.writeFileSync(file, line);
        }
        return result;
      });
      return handle;
    });
    const report = await read();
    expect(report.complete).toBe(false);
    expect(codes(report)).toContain('input-changed');
    expect(report.processBinding).toBe('unbound');
  },
);

it('does not claim a complete read when EOF arrives before the observed size', async () => {
  const originalOpen = fs.promises.open.bind(fs.promises);
  vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    vi.spyOn(handle, 'read').mockResolvedValue({ bytesRead: 0 });
    return handle;
  });
  const report = await read();
  expect(codes(report)).toEqual(['input-changed']);
  expect(report.events).toEqual([]);
});

it.each(['open', 'read', 'close'])(
  'redacts arbitrary %s failure text and closes the handle',
  async (phase) => {
    const originalOpen = fs.promises.open.bind(fs.promises);
    let closed = false;
    vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      if (phase === 'open') throw new Error('PRIVATE_OPEN');
      const handle = await originalOpen(...args);
      const close = handle.close.bind(handle);
      if (phase === 'read') vi.spyOn(handle, 'read').mockRejectedValue(new Error('PRIVATE_READ'));
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        await close();
        closed = true;
        if (phase === 'close') throw new Error('PRIVATE_CLOSE');
      });
      return handle;
    });
    const report = await read();
    expect(report.complete).toBe(false);
    expect(codes(report)).toEqual([phase === 'close' ? 'input-close-failed' : 'input-unavailable']);
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
    if (phase !== 'open') expect(closed).toBe(true);
  },
);

it('bounds physical reads at the exact file-size limit', async () => {
  fs.writeFileSync(file, Buffer.alloc(LIMITS.fileBytes, 120));
  const originalOpen = fs.promises.open.bind(fs.promises);
  const requests = [];
  vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    const read = handle.read.bind(handle);
    vi.spyOn(handle, 'read').mockImplementation(async (...readArgs) => {
      requests.push(readArgs[2]);
      return read(...readArgs);
    });
    return handle;
  });
  const report = await read();
  expect(report.usage.bytes).toBe(LIMITS.fileBytes);
  expect(Math.max(...requests)).toBe(16 * 1024);
  expect(requests.reduce((a, b) => a + b, 0)).toBe(LIMITS.fileBytes);
  expect(codes(report)).toEqual(['unterminated-record']);
});
