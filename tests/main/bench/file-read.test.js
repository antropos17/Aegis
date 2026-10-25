import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { writeFixture } = require('../../../bench/lib/fixture');
const { readOwnedFixture } = require('../../../bench/lib/file-read');
const { MAX_BYTES } = require('../../../bench/lib/file-read-identity');
const directories = [];
const directory = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-read-'));
  directories.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true });
});
function fixture(content = 'AEGIS_PUBLIC_INERT_FILE_READ_V1\n') {
  const runDir = directory(),
    written = writeFixture({ target: 'project', name: 'canary-read.txt', content }, runDir);
  return {
    content,
    runDir,
    written,
    args: {
      runId: 'run-1',
      scenario: 'S8-owned-file-read',
      step: 'read-canary',
      fromStep: 'write-canary',
      runDir,
      ownedFixture: written.result.ownedFixture,
    },
  };
}
describe('owned fixture read boundary', () => {
  it.each([
    (token) => (token.name = '../outside.txt'),
    (token) => (token.compartment = 'outside'),
    (token) => (token.name = ['canary-read.txt']),
    (token) => (token.expectedBytes = MAX_BYTES + 1),
    (token) => (token.expectedSha256 = 'private-hash'),
    (token) => (token.path = 'private-path'),
  ])('rejects invalid private tokens before content access %#', (change) => {
    const item = fixture();
    change(item.args.ownedFixture);
    const read = vi.spyOn(fs, 'readSync');
    const outcome = readOwnedFixture(item.args);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'fixture-token-invalid',
      readBytes: null,
      closure: { opened: false },
    });
    expect(read).not.toHaveBeenCalled();
    expect(JSON.stringify(outcome)).not.toMatch(/private-|outside\.txt/);
  });
  it('reconstructs the path under the actual run directory and refuses cross-run token replay', () => {
    const original = fixture(),
      another = fixture(),
      read = vi.spyOn(fs, 'readSync');
    another.args.ownedFixture = original.args.ownedFixture;
    expect(readOwnedFixture(another.args)).toMatchObject({
      status: 'failed',
      reason: 'changed-before-read',
      closure: { opened: false },
    });
    expect(read).not.toHaveBeenCalled();
  });
  it('refuses actual same-content path replacement during the descriptor read', () => {
    const item = fixture(),
      read = fs.readSync,
      file = item.written.result.path;
    vi.spyOn(fs, 'readSync').mockImplementationOnce((...args) => {
      const count = read(...args);
      fs.renameSync(file, file + '.old');
      fs.writeFileSync(file, item.content);
      return count;
    });
    const outcome = readOwnedFixture(item.args);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'changed-during-read',
      readBytes: Buffer.byteLength(item.content),
      closure: { closed: true },
    });
    expect(outcome.namedIdentitySha256).not.toBe(outcome.originalIdentitySha256);
  });
  it('counts and hashes encoded multibyte UTF-8 bytes rather than UTF-16 units', () => {
    const item = fixture('AEGIS public inert: 測試🙂\n'),
      bytes = Buffer.from(item.content, 'utf8');
    expect(bytes.length).not.toBe(item.content.length);
    expect(readOwnedFixture(item.args)).toMatchObject({
      status: 'complete',
      expectedBytes: bytes.length,
      readBytes: bytes.length,
      readSha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });
  it('uses post-close named timestamps while retaining descriptor creation identity', () => {
    const runDir = directory(),
      file = path.join(runDir, 'fixtures', 'project', 'canary-read.txt'),
      close = fs.closeSync;
    const spy = vi.spyOn(fs, 'closeSync').mockImplementationOnce((fd) => {
      close(fd);
      fs.utimesSync(file, new Date('2000-01-01Z'), new Date('2000-01-01Z'));
    });
    const written = writeFixture(
      { target: 'project', name: 'canary-read.txt', content: 'public inert\n' },
      runDir,
    );
    spy.mockRestore();
    expect(written.result.ownedFixture.identity.mtimeNs).toBe(
      fs.lstatSync(file, { bigint: true }).mtimeNs.toString(),
    );
    expect(
      readOwnedFixture({ ...fixture().args, runDir, ownedFixture: written.result.ownedFixture })
        .status,
    ).toBe('complete');
  });
  it('does not fabricate identity when creation identity is unavailable', () => {
    const stat = fs.fstatSync;
    vi.spyOn(fs, 'fstatSync').mockImplementationOnce((...args) => {
      const real = stat(...args);
      return { ...real, ino: 0n, isFile: () => true };
    });
    const item = fixture(),
      read = vi.spyOn(fs, 'readSync');
    expect(item.written.result.ownedFixture.identity).toBeNull();
    expect(readOwnedFixture(item.args)).toMatchObject({
      status: 'failed',
      reason: 'identity-unavailable',
      originalIdentitySha256: null,
      closure: { opened: false, closed: null },
    });
    expect(read).not.toHaveBeenCalled();
  });
  it('loops over legitimate short chunks until actual EOF', () => {
    const item = fixture(),
      read = fs.readSync;
    const spy = vi
      .spyOn(fs, 'readSync')
      .mockImplementation((fd, bytes, offset, length, position) =>
        read(fd, bytes, offset, Math.min(length, 3), position),
      );
    expect(readOwnedFixture(item.args)).toMatchObject({
      status: 'complete',
      readBytes: Buffer.byteLength(item.content),
    });
    expect(spy.mock.calls.length).toBeGreaterThan(2);
  });
  it('refuses premature EOF with the observed prefix retained', () => {
    const item = fixture(),
      read = fs.readSync;
    vi.spyOn(fs, 'readSync')
      .mockImplementationOnce((fd, bytes, offset, _length, position) =>
        read(fd, bytes, offset, 5, position),
      )
      .mockReturnValueOnce(0);
    expect(readOwnedFixture(item.args)).toMatchObject({
      status: 'failed',
      reason: 'length-mismatch',
      readBytes: 5,
      readSha256: createHash('sha256')
        .update(Buffer.from(item.content).subarray(0, 5))
        .digest('hex'),
      progressKnown: true,
      closure: { closed: true },
    });
  });
  it('keeps only successfully returned progress when a later read writes a buffer then throws', () => {
    const item = fixture(),
      read = fs.readSync;
    vi.spyOn(fs, 'readSync')
      .mockImplementationOnce((fd, bytes, offset, _length, position) =>
        read(fd, bytes, offset, 5, position),
      )
      .mockImplementationOnce((_fd, bytes, offset) => {
        bytes.fill(122, offset, offset + 3);
        throw new Error('private-read-error-sentinel');
      });
    const outcome = readOwnedFixture(item.args);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'read-unavailable',
      readBytes: 5,
      readSha256: createHash('sha256')
        .update(Buffer.from(item.content).subarray(0, 5))
        .digest('hex'),
      progressKnown: false,
      closure: { closed: true },
    });
    expect(JSON.stringify(outcome)).not.toContain('private');
  });
  it('discriminates actual returned bytes from metadata by independently checking their hash', () => {
    const item = fixture(),
      read = fs.readSync,
      altered = Buffer.from(item.content);
    altered[0] ^= 1;
    vi.spyOn(fs, 'readSync').mockImplementationOnce((fd, bytes, offset, length, position) => {
      const count = read(fd, bytes, offset, length, position);
      bytes[offset] ^= 1;
      return count;
    });
    expect(readOwnedFixture(item.args)).toMatchObject({
      status: 'failed',
      reason: 'digest-mismatch',
      readBytes: altered.length,
      readSha256: createHash('sha256').update(altered).digest('hex'),
      closure: { closed: true },
    });
  });
  it.each(['dev', 'ino'])(
    'requires the original creation %s even when all other metadata matches',
    (field) => {
      const item = fixture(),
        read = vi.spyOn(fs, 'readSync');
      item.args.ownedFixture.identity[field] = (
        BigInt(item.args.ownedFixture.identity[field]) + 1n
      ).toString();
      expect(readOwnedFixture(item.args)).toMatchObject({
        status: 'failed',
        reason: 'changed-before-read',
        closure: { opened: false },
      });
      expect(read).not.toHaveBeenCalled();
    },
  );
  it.each(['mutation', 'truncation', 'growth', 'replacement', 'disappearance', 'hardlink'])(
    'refuses %s before any content read',
    (change) => {
      const item = fixture(),
        file = item.written.result.path;
      if (change === 'mutation') {
        fs.writeFileSync(file, 'X'.repeat(Buffer.byteLength(item.content)));
        fs.utimesSync(file, new Date('2001-01-01Z'), new Date('2001-01-01Z'));
      }
      if (change === 'truncation') fs.truncateSync(file, 2);
      if (change === 'growth') fs.appendFileSync(file, 'growth');
      if (change === 'replacement') {
        fs.renameSync(file, file + '.original');
        fs.writeFileSync(file, item.content);
      }
      if (change === 'disappearance') fs.unlinkSync(file);
      if (change === 'hardlink') fs.linkSync(file, path.join(item.runDir, 'extra-link'));
      const read = vi.spyOn(fs, 'readSync');
      expect(readOwnedFixture(item.args).status).toBe('failed');
      expect(read).not.toHaveBeenCalled();
    },
  );
  it('refuses terminal symbolic-link metadata before content open', () => {
    const item = fixture(),
      lstat = fs.lstatSync,
      read = vi.spyOn(fs, 'readSync');
    vi.spyOn(fs, 'lstatSync').mockImplementation((file, ...args) => {
      const stat = lstat(file, ...args);
      return file === item.written.result.path
        ? { ...stat, isSymbolicLink: () => true, isFile: () => true }
        : stat;
    });
    expect(readOwnedFixture(item.args)).toMatchObject({
      status: 'failed',
      reason: 'unsafe-owned-path',
    });
    expect(read).not.toHaveBeenCalled();
  });
  it('refuses a real junction/symlink compartment before content open', () => {
    const item = fixture(),
      project = path.dirname(item.written.result.path),
      moved = path.join(item.runDir, 'moved-project');
    fs.renameSync(project, moved);
    fs.symlinkSync(moved, project, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const read = vi.spyOn(fs, 'readSync');
      expect(readOwnedFixture(item.args)).toMatchObject({
        status: 'failed',
        reason: 'unsafe-owned-path',
      });
      expect(read).not.toHaveBeenCalled();
    } finally {
      fs.unlinkSync(project);
    }
  });
  it('rejects a descriptor identity differing from the original after a safe named check', () => {
    const item = fixture(),
      stat = fs.fstatSync,
      read = vi.spyOn(fs, 'readSync');
    vi.spyOn(fs, 'fstatSync').mockImplementationOnce((...args) => {
      const real = stat(...args);
      return { ...real, ino: real.ino + 1n, isFile: () => true };
    });
    expect(readOwnedFixture(item.args)).toMatchObject({
      status: 'failed',
      reason: 'changed-before-read',
      closure: { opened: true, closed: true },
    });
    expect(read).not.toHaveBeenCalled();
  });
  it('refuses named replacement after reading even when descriptor metadata is unchanged', () => {
    const item = fixture(),
      stat = fs.lstatSync;
    let visits = 0;
    vi.spyOn(fs, 'lstatSync').mockImplementation((file, ...args) => {
      const real = stat(file, ...args);
      return file === item.written.result.path && ++visits === 2
        ? { ...real, ino: real.ino + 1n, isFile: () => true }
        : real;
    });
    const result = readOwnedFixture(item.args);
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'changed-during-read',
      closure: { closed: true },
    });
    expect(result.postIdentitySha256).toBe(result.originalIdentitySha256);
    expect(result.namedIdentitySha256).not.toBe(result.originalIdentitySha256);
  });
  it('refuses changed post-descriptor identity when the final named identity remains original', () => {
    const item = fixture(),
      stat = fs.fstatSync;
    let calls = 0;
    vi.spyOn(fs, 'fstatSync').mockImplementation((...args) => {
      const real = stat(...args);
      return ++calls === 2 ? { ...real, ino: real.ino + 1n, isFile: () => true } : real;
    });
    const result = readOwnedFixture(item.args);
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'changed-during-read',
      readBytes: Buffer.byteLength(item.content),
      closure: { closed: true },
    });
    expect(calls).toBe(2);
    expect(result.namedIdentitySha256).toBe(result.originalIdentitySha256);
    expect(result.postIdentitySha256).not.toBe(result.originalIdentitySha256);
  });
  it.skipIf(!fs.constants.O_NOFOLLOW)(
    'refuses a real terminal symlink swapped immediately before the guarded open',
    () => {
      const item = fixture(),
        file = item.written.result.path,
        other = path.join(item.runDir, 'other-file.txt'),
        open = fs.openSync;
      fs.writeFileSync(other, 'another owned inert fixture\n');
      const read = vi.spyOn(fs, 'readSync'),
        close = vi.spyOn(fs, 'closeSync');
      const opened = vi.spyOn(fs, 'openSync').mockImplementation((target, ...args) => {
        if (target === file) {
          fs.renameSync(file, file + '.original');
          fs.symlinkSync(other, file, 'file');
        }
        return open(target, ...args);
      });
      try {
        expect(readOwnedFixture(item.args)).toMatchObject({
          status: 'failed',
          reason: 'open-unavailable',
          readBytes: null,
          closure: { opened: false, closeAttempted: false, closed: null },
        });
        expect(opened).toHaveBeenCalledTimes(1);
        expect(read).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
      } finally {
        if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file);
      }
    },
  );
  it('refuses same-size mutation during a read without discarding returned bytes', () => {
    const item = fixture(),
      read = fs.readSync;
    vi.spyOn(fs, 'readSync').mockImplementationOnce((...args) => {
      const count = read(...args);
      fs.writeFileSync(item.written.result.path, 'Z'.repeat(Buffer.byteLength(item.content)));
      fs.utimesSync(item.written.result.path, new Date('2001-01-01Z'), new Date('2001-01-01Z'));
      return count;
    });
    expect(readOwnedFixture(item.args)).toMatchObject({
      status: 'failed',
      reason: 'changed-during-read',
      readBytes: Buffer.byteLength(item.content),
      closure: { closed: true },
    });
  });
  it('bounds growth during the read to one fixed buffer plus a sentinel', () => {
    const item = fixture(),
      read = fs.readSync;
    const spy = vi.spyOn(fs, 'readSync').mockImplementationOnce((...args) => {
      const count = read(...args);
      fs.appendFileSync(item.written.result.path, Buffer.alloc(MAX_BYTES, 65));
      return count;
    });
    expect(readOwnedFixture(item.args)).toMatchObject({
      status: 'failed',
      reason: 'read-limit',
      readBytes: MAX_BYTES + 1,
      closure: { closed: true },
    });
    expect(
      spy.mock.calls.every((call) => call[1].length === MAX_BYTES + 1 && call[3] <= MAX_BYTES + 1),
    ).toBe(true);
  });
  it('does not retry an uncertain close or claim success after a close exception', () => {
    const item = fixture(),
      close = fs.closeSync;
    let closedFd;
    const spy = vi.spyOn(fs, 'closeSync').mockImplementationOnce((fd) => {
      close(fd);
      closedFd = fd;
      throw new Error('private-close-sentinel');
    });
    expect(readOwnedFixture(item.args)).toMatchObject({
      status: 'failed',
      reason: 'close-unavailable',
      closure: { opened: true, closeAttempted: true, closed: null },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(() => fs.fstatSync(closedFd)).toThrow();
  });
  it('reads actual bytes through one closed descriptor and confirms the original identity', () => {
    const runDir = directory(),
      content = 'AEGIS_PUBLIC_INERT_FILE_READ_V1\n';
    const written = writeFixture({ target: 'project', name: 'canary-read.txt', content }, runDir);
    const open = vi.spyOn(fs, 'openSync'),
      close = vi.spyOn(fs, 'closeSync');
    const outcome = readOwnedFixture({
      runId: 'run-1',
      scenario: 'S8-owned-file-read',
      step: 'read-canary',
      fromStep: 'write-canary',
      runDir,
      ownedFixture: written.result.ownedFixture,
    });
    expect(outcome).toMatchObject({
      status: 'complete',
      reason: null,
      expectedBytes: Buffer.byteLength(content),
      readBytes: Buffer.byteLength(content),
      readSha256: createHash('sha256').update(Buffer.from(content)).digest('hex'),
      progressKnown: true,
      closure: { opened: true, closeAttempted: true, closed: true },
    });
    expect(outcome.originalIdentitySha256).toBe(outcome.preIdentitySha256);
    expect(outcome.postIdentitySha256).toBe(outcome.preIdentitySha256);
    expect(outcome.namedIdentitySha256).toBe(outcome.preIdentitySha256);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      written.result.path,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(open.mock.results[0].value);
  });
  it('creates and hashes written bytes without an unlabelled content readback', () => {
    const runDir = directory(),
      content = 'AEGIS_PUBLIC_INERT_FILE_READ_V1\n';
    const read = vi.spyOn(fs, 'readFileSync');
    const written = writeFixture({ target: 'project', name: 'canary-read.txt', content }, runDir);
    expect(read).not.toHaveBeenCalled();
    expect(written.observed.sha256).toBe(
      createHash('sha256').update(Buffer.from(content)).digest('hex'),
    );
    expect(written.result.ownedFixture).toMatchObject({
      compartment: 'project',
      name: 'canary-read.txt',
      expectedBytes: Buffer.byteLength(content),
      creationClosed: true,
    });
    expect(written.result.ownedFixture.identity).not.toBeNull();
  });
});
