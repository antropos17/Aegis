import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, options, fixtureDeps } from './linux-own-cpu-fixtures.js';
const require = createRequire(import.meta.url);
const reference = require('../../../bench/lib/linux-own-cpu-reference');
const { WORK } = require('../../../bench/lib/linux-own-cpu-work');
const storage = require('../../../bench/lib/linux-own-cpu-storage');
afterEach(cleanup);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function jump(count) {
  const mask = (1n << 32n) - 1n;
  let a = 1664525n,
    c = 1013904223n,
    resultA = 1n,
    resultC = 0n,
    remaining = BigInt(count);
  while (remaining) {
    if (remaining & 1n) {
      resultC = (a * resultC + c) & mask;
      resultA = (a * resultA) & mask;
    }
    c = (a * c + c) & mask;
    a = (a * a) & mask;
    remaining >>= 1n;
  }
  return Number((resultA + resultC) & mask);
}
describe('fixed Linux SELF CPU reference composition (CI only)', () => {
  it('uses the unchanged sampler, retains exact bindings and independently verifies the full fixed burst checksum', async () => {
    const opts = options(),
      deps = fixtureDeps();
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
      for (const value of declarations.values()) if (value.fd === fd) value.closed = true;
    });
    let boundary;
    const cpu = deps.cpuUsage;
    deps.cpuUsage = () => {
      if (!boundary) {
        const descriptors = ['cpu-reference-plan.json', 'cpu-reference-pending.json'].map(
          (file) => {
            const value = declarations.get(file);
            let code = null;
            if (value) {
              try {
                fstat(value.fd);
              } catch (err) {
                code = err.code;
              }
            }
            return { file, closed: value?.closed ?? false, code };
          },
        );
        boundary = {
          descriptors,
          plan: JSON.parse(fs.readFileSync(path.join(opts.out, 'cpu-reference-plan.json'), 'utf8')),
          pending: JSON.parse(
            fs.readFileSync(path.join(opts.out, 'cpu-reference-pending.json'), 'utf8'),
          ),
        };
      }
      return cpu();
    };
    const result = await reference.runLinuxOwnCpuReference(opts, deps);
    expect(result.exitCode).toBe(0);
    expect(boundary.pending.state).toBe('pending');
    expect(boundary.descriptors).toEqual(
      ['cpu-reference-plan.json', 'cpu-reference-pending.json'].map((file) => ({
        file,
        closed: true,
        code: 'EBADF',
      })),
    );
    expect(boundary.plan.model).toMatchObject({
      tickEndpointAllowance: 2,
      apiEndpointAllowanceUs: 2,
      upperBoundary: 'exclusive',
      kernelModelQualified: false,
    });
    const rawBytes = fs.readFileSync(path.join(opts.out, 'raw-samples.json')),
      windowsBytes = fs.readFileSync(path.join(opts.out, 'cpu-reference-windows.json'));
    const raw = JSON.parse(rawBytes),
      windows = JSON.parse(windowsBytes);
    expect(raw).toMatchObject({
      version: 'self-resource-samples/1',
      readingMode: 'injected',
      plannedPoints: 2,
      plannedDurationUs: 2000000,
      complete: true,
    });
    expect(raw.samples.map((s) => s.rss.residentBytes)).toEqual([4096, 4096]);
    expect(windows).not.toHaveProperty('rss');
    expect(windows).not.toHaveProperty('memory');
    expect(result.receipt).not.toHaveProperty('rss');
    expect(result.receipt).not.toHaveProperty('memory');
    for (const row of windows.windows)
      expect(Object.keys(row).sort()).toEqual(['after', 'api', 'before', 'index', 'reason']);
    expect(result.receipt).toMatchObject({
      collectionMode: 'injected-test-seams',
      state: 'consistent-under-declared-model',
      finalPublication: 'not-self-attested',
      rssAssessment: 'not-qualified',
      sourceAuthenticated: false,
      measurementAccepted: false,
      calibrationAccepted: false,
      w8Accepted: false,
    });
    expect(result.receipt.rawSha256).toBe(sha(rawBytes));
    expect(result.receipt.windowsSha256).toBe(sha(windowsBytes));
    expect(result.receipt.workload).toMatchObject({
      state: 'completed',
      completedIterations: WORK.iterations,
      checksum: jump(WORK.iterations),
    });
    expect(windows.workload).toEqual(result.receipt.workload);
    for (const [i, row] of windows.windows.entries())
      expect(row.api).toMatchObject({
        userUs: raw.samples[i].cpu.userUs,
        systemUs: raw.samples[i].cpu.systemUs,
      });
    expect(result.receipt.files).toHaveLength(4);
    for (const file of result.receipt.files) {
      const bytes = fs.readFileSync(path.join(opts.out, file.file));
      expect(file).toMatchObject({ sha256: sha(bytes), byteLength: bytes.length, closed: true });
    }
    expect(JSON.stringify(result.receipt)).not.toContain(JSON.stringify(opts.out).slice(1, -1));
    expect(windowsBytes.toString('utf8')).not.toContain('private name');
    expect(fs.readdirSync(opts.out).sort()).toEqual([
      'cpu-reference-final.json',
      'cpu-reference-pending.json',
      'cpu-reference-plan.json',
      'cpu-reference-windows.json',
      'raw-samples.json',
    ]);
  });
  it('retains partial fixed work and its exact independent checksum without passing', async () => {
    const opts = options(),
      result = await reference.runLinuxOwnCpuReference(opts, fixtureDeps(100000000n));
    expect(result.exitCode).toBe(3);
    expect(result.receipt.workload.state).toBe('partial');
    expect(result.receipt.workload.reason).toBe('work-budget');
    expect(result.receipt.workload.completedIterations).toBeLessThan(WORK.iterations);
    expect(result.receipt.workload.checksum).toBe(
      jump(result.receipt.workload.completedIterations),
    );
    expect(result.receipt.comparison.state).not.toBe('consistent-under-declared-model');
  });
  it('retains a pre-aborted sampler tail without any CPU reader, clock or work', async () => {
    const opts = options(),
      deps = fixtureDeps(),
      controller = new AbortController();
    controller.abort();
    deps.cpuUsage = vi.fn(deps.cpuUsage);
    deps.nowNs = vi.fn(deps.nowNs);
    deps.readStat = vi.fn(deps.readStat);
    const result = await reference.runLinuxOwnCpuReference(
      { ...opts, signal: controller.signal },
      deps,
    );
    expect(result.exitCode).toBe(3);
    expect(deps.cpuUsage).not.toHaveBeenCalled();
    expect(deps.nowNs).not.toHaveBeenCalled();
    expect(deps.readStat).not.toHaveBeenCalled();
    const raw = JSON.parse(fs.readFileSync(path.join(opts.out, 'raw-samples.json')));
    expect(raw).toMatchObject({
      complete: false,
      samples: [],
      unattempted: { count: 2, reason: 'cancelled' },
    });
    expect(result.receipt.workload.completedIterations).toBe(0);
  });
  it.each(['changed', 'unavailable'])(
    'retains evidence when final source endpoints are %s',
    async (state) => {
      const opts = options(),
        deps = fixtureDeps(),
        controller = new AbortController(),
        inventory = storage.inventory;
      controller.abort();
      let calls = 0;
      vi.spyOn(storage, 'inventory').mockImplementation(() => {
        if (++calls === 1) return inventory();
        if (state === 'unavailable') throw Error('private-source-error');
        const value = inventory();
        value.files[0].sha256 = '0'.repeat(64);
        return value;
      });
      const result = await reference.runLinuxOwnCpuReference(
        { ...opts, signal: controller.signal },
        deps,
      );
      expect(result.exitCode).toBe(7);
      expect(result.receipt.sources.state).toBe(state);
      expect(fs.existsSync(path.join(opts.out, 'raw-samples.json'))).toBe(true);
      expect(JSON.stringify(result.receipt)).not.toContain('private-source-error');
    },
  );
  it.each(['unsupported', 'getconf-error', 'getconf-timeout', 'nondivisor', 'source-unavailable'])(
    'refuses %s before observation or fixed work',
    async (mode) => {
      const opts = options(),
        deps = fixtureDeps();
      deps.cpuUsage = vi.fn(deps.cpuUsage);
      deps.readStat = vi.fn(deps.readStat);
      deps.nowNs = vi.fn(deps.nowNs);
      deps.getconf = vi.fn(() => {
        if (mode === 'getconf-error' || mode === 'getconf-timeout') {
          const error = Error('private-getconf-error');
          error.code = mode === 'getconf-timeout' ? 'ETIMEDOUT' : 'ENOENT';
          throw error;
        }
        return Buffer.from(mode === 'nondivisor' ? '3\n' : '100\n');
      });
      if (mode === 'unsupported') deps.platform = () => 'win32';
      if (mode === 'source-unavailable')
        vi.spyOn(storage, 'inventory').mockImplementation(() => {
          throw Error('private-source-error');
        });
      const result = await reference.runLinuxOwnCpuReference(opts, deps);
      expect(result.exitCode).toBe(7);
      expect(deps.cpuUsage).not.toHaveBeenCalled();
      expect(deps.readStat).not.toHaveBeenCalled();
      expect(deps.nowNs).not.toHaveBeenCalled();
      if (mode === 'unsupported') expect(deps.getconf).not.toHaveBeenCalled();
      expect(fs.existsSync(opts.out)).toBe(false);
      expect(JSON.stringify(result.receipt)).not.toContain('private-getconf-error');
      expect(JSON.stringify(result.receipt)).not.toContain('private-source-error');
    },
  );
  it.each(['accessor', 'prototype', 'extra', 'nonfunction'])(
    'refuses invalid %s before filesystem or preflight',
    async (mode) => {
      const opts = options(),
        deps = fixtureDeps();
      let getters = 0;
      if (mode === 'accessor')
        Object.defineProperty(opts, 'runId', {
          enumerable: true,
          get() {
            getters++;
            return 'private';
          },
        });
      if (mode === 'prototype') Object.setPrototypeOf(opts, {});
      if (mode === 'extra') opts.pid = process.pid;
      if (mode === 'nonfunction') deps.getconf = 'private';
      const inspect = vi.spyOn(fs, 'lstatSync');
      deps.platform = vi.fn(deps.platform);
      await expect(reference.runLinuxOwnCpuReference(opts, deps)).rejects.toThrow(
        /^linux-own-cpu-input-invalid$/,
      );
      expect(getters).toBe(0);
      expect(inspect).not.toHaveBeenCalled();
      expect(deps.platform).not.toHaveBeenCalled();
    },
  );
});
