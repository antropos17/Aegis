import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, options, fixture, end, json, sha } from './resource-supervisor-fixtures.js';
const require = createRequire(import.meta.url);
const supervisor = require('../../../bench/lib/resource-supervisor');
const storage = require('../../../bench/lib/resource-supervisor-storage');
afterEach(cleanup);
describe('fixed-child resource supervisor (CI only)', () => {
  it('closes declarations before fixed spawn and retains sanitized lifecycle and exact stream hashes', async () => {
    const opts = options(),
      f = fixture();
    const open = fs.openSync,
      close = fs.closeSync,
      fstat = fs.fstatSync,
      declarations = new Map();
    vi.spyOn(fs, 'openSync').mockImplementation((file, flags, ...args) => {
      const fd = open(file, flags, ...args);
      if (
        path.dirname(String(file)) === opts.out &&
        typeof flags === 'number' &&
        flags & fs.constants.O_EXCL
      )
        declarations.set(path.basename(file), { fd, closed: false });
      return fd;
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      close(fd);
      for (const entry of declarations.values()) if (entry.fd === fd) entry.closed = true;
    });
    let boundary;
    f.deps.spawn.mockImplementation((command, args, spawnOptions) => {
      const descriptors = ['supervision-plan.json', 'supervision-pending.json'].map((file) => {
        const entry = declarations.get(file);
        let errorCode = null;
        if (entry) {
          try {
            fstat(entry.fd);
          } catch (err) {
            errorCode = err.code;
          }
        }
        return { file, closed: entry?.closed ?? false, errorCode };
      });
      boundary = {
        command,
        args,
        spawnOptions,
        descriptors,
        plan: json(opts.out, 'supervision-plan.json'),
        pending: json(opts.out, 'supervision-pending.json'),
      };
      return f.child;
    });
    const pending = supervisor.superviseSelfResources(opts, f.deps);
    f.child.emit('spawn');
    const secret = Buffer.from('private-child-output\0\n');
    f.child.stdout.emit('data', secret.subarray(0, 3));
    f.child.stdout.emit('data', secret.subarray(3));
    end(f.child);
    const result = await pending;
    expect(result.exitCode).toBe(0);
    expect(boundary.descriptors).toEqual(
      ['supervision-plan.json', 'supervision-pending.json'].map((file) => ({
        file,
        closed: true,
        errorCode: 'EBADF',
      })),
    );
    expect(boundary.command).toBe(process.execPath);
    expect(boundary.args).toEqual([
      path.join(storage.ROOT, 'bench/self-resource-run.cjs'),
      '--run-id',
      opts.runId,
      '--duration-ms',
      '1000',
      '--max-acquisition-us',
      '1000',
      '--max-cpu-uncertainty-us',
      '2000',
      '--out',
      path.join(opts.out, 'capture'),
    ]);
    expect(boundary.spawnOptions).toMatchObject({
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(boundary.spawnOptions).not.toHaveProperty('execArgv');
    expect(Object.keys(boundary.spawnOptions.env).sort()).toEqual(
      [
        'NODE_DISABLE_COMPILE_CACHE',
        'TEMP',
        'TMP',
        'TMPDIR',
        ...['SystemRoot', 'WINDIR'].filter((key) => process.env[key] !== undefined),
      ].sort(),
    );
    expect(boundary.spawnOptions.env.TEMP).toBe(path.join(opts.out, 'temporary'));
    expect(boundary.spawnOptions.cwd).toBe(path.join(opts.out, 'temporary'));
    expect(boundary.spawnOptions.env.TMP).toBe(path.join(opts.out, 'temporary'));
    expect(boundary.spawnOptions.env.TMPDIR).toBe(path.join(opts.out, 'temporary'));
    expect(boundary.spawnOptions.env.NODE_DISABLE_COMPILE_CACHE).toBe('1');
    expect(boundary.pending).toMatchObject({
      state: 'pending',
      planSha256: sha(fs.readFileSync(path.join(opts.out, 'supervision-plan.json'))),
    });
    expect(result.receipt).toMatchObject({
      executionMode: 'injected',
      childBundleAssessment: 'not-inspected',
      finalPublication: 'not-self-attested',
      sourceAuthenticated: false,
      measurementAccepted: false,
      w8Accepted: false,
    });
    expect(result.receipt.supervision.stdout).toMatchObject({
      observedBytes: secret.length,
      hashBytes: secret.length,
      sha256: sha(secret),
      complete: true,
    });
    expect(result.receipt.supervision.exit).toEqual({ observed: true, code: 0, signal: null });
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(f.timers.size).toBe(0);
    const serialized = JSON.stringify(result.receipt);
    expect(serialized).not.toContain('private-child-output');
    expect(serialized).not.toContain(JSON.stringify(opts.out).slice(1, -1));
    expect(result.receipt.files.map((file) => file.file)).toEqual([
      'supervision-plan.json',
      'supervision-pending.json',
    ]);
  });
  it.each(['source-over-child', 'publication-over-source'])(
    'retains independent failure precedence: %s',
    async (mode) => {
      const opts = options(),
        f = fixture(),
        inventory = storage.inventory,
        open = fs.openSync;
      let calls = 0;
      vi.spyOn(storage, 'inventory').mockImplementation(() => {
        const value = inventory();
        if (++calls > 1) value.files[0].sha256 = 'f'.repeat(64);
        return value;
      });
      if (mode === 'publication-over-source')
        vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
          if (file === path.join(opts.out, 'supervision-final.json'))
            throw Error('private-final-error');
          return open(file, ...args);
        });
      const pending = supervisor.superviseSelfResources(opts, f.deps);
      f.child.emit('spawn');
      end(f.child, 7);
      const result = await pending;
      expect(result.exitCode).toBe(mode === 'source-over-child' ? 4 : 6);
      expect(result.receipt.sources.state).toBe('changed');
      expect(result.receipt.supervision.exit.code).toBe(7);
      expect(result.receipt.state).toBe(
        mode === 'source-over-child' ? 'source-refused' : 'persistence-failed',
      );
      expect(json(opts.out, 'supervision-pending.json').state).toBe('pending');
      expect(JSON.stringify(result.receipt)).not.toContain('private-final-error');
    },
  );
  it('validates before filesystem, timers or spawning and refuses undeclared commands', async () => {
    const opts = options(),
      f = fixture(),
      inspect = vi.spyOn(fs, 'lstatSync');
    await expect(
      supervisor.superviseSelfResources({ ...opts, command: 'private-command' }, f.deps),
    ).rejects.toThrow('resource-supervisor-input-invalid');
    expect(inspect).not.toHaveBeenCalled();
    expect(f.deps.spawn).not.toHaveBeenCalled();
    expect(f.timers.size).toBe(0);
  });
  it.each(['before', 'changed', 'unavailable'])(
    'keeps source inventory refusal distinct from child lifecycle: %s',
    async (mode) => {
      const opts = options(),
        f = fixture(),
        inventory = storage.inventory;
      let calls = 0;
      vi.spyOn(storage, 'inventory').mockImplementation(() => {
        if (++calls === 1 && mode !== 'before') return inventory();
        if (mode !== 'changed') throw Error('private-source-error');
        const result = inventory();
        result.files[0].sha256 = 'f'.repeat(64);
        return result;
      });
      const pending = supervisor.superviseSelfResources(opts, f.deps);
      if (mode !== 'before') {
        f.child.emit('spawn');
        end(f.child);
      }
      const result = await pending;
      expect(result.exitCode).toBe(4);
      if (mode === 'before') {
        expect(f.deps.spawn).not.toHaveBeenCalled();
        expect(fs.existsSync(opts.out)).toBe(false);
      } else {
        expect(result.receipt.sources.state).toBe(mode);
        expect(fs.existsSync(path.join(opts.out, 'supervision-pending.json'))).toBe(true);
      }
      expect(JSON.stringify(result.receipt)).not.toContain('private-source-error');
    },
  );
  it.each(['supervision-plan.json', 'supervision-pending.json'])(
    'does not spawn when %s cannot be created',
    async (name) => {
      const opts = options(),
        f = fixture(),
        open = fs.openSync;
      vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
        if (file === path.join(opts.out, name)) throw Error('private-output-error');
        return open(file, ...args);
      });
      const result = await supervisor.superviseSelfResources(opts, f.deps);
      expect(result.exitCode).toBe(6);
      expect(f.deps.spawn).not.toHaveBeenCalled();
      expect(f.timers.size).toBe(0);
      expect(result.receipt.files.map((file) => file.file)).toEqual(
        name === 'supervision-plan.json' ? [] : ['supervision-plan.json'],
      );
      expect(JSON.stringify(result.receipt)).not.toContain('private-output-error');
    },
  );
  it('retains pending evidence and returns persistence failure on final close uncertainty', async () => {
    const opts = options(),
      f = fixture(),
      open = fs.openSync,
      close = fs.closeSync;
    let finalFd,
      failed = false;
    vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
      const fd = open(file, ...args);
      if (file === path.join(opts.out, 'supervision-final.json')) finalFd = fd;
      return fd;
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      close(fd);
      if (fd === finalFd && !failed) {
        failed = true;
        throw Error('private-close-error');
      }
    });
    const pending = supervisor.superviseSelfResources(opts, f.deps);
    f.child.emit('spawn');
    end(f.child);
    const result = await pending;
    expect(result.exitCode).toBe(6);
    expect(json(opts.out, 'supervision-pending.json').state).toBe('pending');
    expect(json(opts.out, 'supervision-final.json').finalPublication).toBe('not-self-attested');
  });
});
