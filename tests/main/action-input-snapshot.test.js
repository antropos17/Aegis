import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { captureInputSnapshot, MAX_INPUT_BYTES } = require('../../src/main/action-input-snapshot');
const roots = [];
function source(bytes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-input-snapshot-'));
  roots.push(root);
  const selected = path.join(root, 'source.bin');
  fs.writeFileSync(selected, bytes);
  return selected;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== 'win32')('bounded private input preview', () => {
  it('captures the exact 64 KiB boundary and refuses one extra byte', () => {
    const selected = source(Buffer.alloc(MAX_INPUT_BYTES, 0x61));
    expect(captureInputSnapshot(selected)).toMatchObject({ size: MAX_INPUT_BYTES });
    fs.appendFileSync(selected, 'b');
    expect(() => captureInputSnapshot(selected)).toThrow('input-unavailable');
  });

  it('caps the actual read when the source grows after the first handle stat', () => {
    const selected = source('approved');
    let changed = false;
    let previewBuffer;
    const io = Object.create(fs);
    io.readFileSync = vi.fn(() => {
      throw Error('unbounded read attempted');
    });
    io.readSync = (...args) => {
      previewBuffer = args[1];
      if (!changed) {
        changed = true;
        fs.appendFileSync(selected, Buffer.alloc(MAX_INPUT_BYTES));
      }
      return fs.readSync(...args);
    };
    expect(() => captureInputSnapshot(selected, io)).toThrow('input-unavailable');
    expect(changed).toBe(true);
    expect(previewBuffer.every((byte) => byte === 0)).toBe(true);
    expect(io.readFileSync).not.toHaveBeenCalled();
  });
});
