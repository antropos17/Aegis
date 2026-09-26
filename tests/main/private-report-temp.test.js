import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const reports = require('../../src/main/private-report-temp.js');
const ownedName = (kind, hex) => `aegis-${kind}-${hex.repeat(32)}.html`;
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-report-temp-test-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(root, { recursive: true, force: true });
});

describe('private report temp storage', () => {
  it('writes unique, exclusive files and does not replace an existing report', () => {
    const directory = reports.reportDirectory(root, true);
    const collision = path.join(directory, ownedName('report', 'a'));
    fs.writeFileSync(collision, 'keep this file');
    vi.spyOn(crypto, 'randomBytes')
      .mockReturnValueOnce(Buffer.alloc(16, 0xaa))
      .mockReturnValueOnce(Buffer.alloc(16, 0xbb));
    const written = reports.writePrivateReport(root, 'report', 'PRIVATE PATH');
    expect(path.basename(written)).toBe(ownedName('report', 'b'));
    expect(fs.readFileSync(collision, 'utf8')).toBe('keep this file');
    expect(fs.readFileSync(written, 'utf8')).toBe('PRIVATE PATH');
    expect(path.dirname(written)).toBe(directory);
    if (process.platform !== 'win32') {
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
      expect(fs.statSync(written).mode & 0o777).toBe(0o600);
    }
  });

  it('prunes age and excess logical bytes while preserving recent and foreign files', () => {
    const directory = reports.reportDirectory(root, true);
    const now = Date.now();
    const aged = path.join(directory, ownedName('report', '1'));
    const oldest = path.join(directory, ownedName('report', '2'));
    const recent = path.join(directory, ownedName('threat-report', '3'));
    const foreign = path.join(directory, 'someone-else.html');
    const expired = path.join(directory, ownedName('report', '4'));
    for (const target of [aged, oldest, recent, foreign, expired])
      fs.writeFileSync(target, 'PRIVATE');
    fs.truncateSync(aged, 40 * 1024 * 1024);
    fs.truncateSync(oldest, 40 * 1024 * 1024);
    fs.utimesSync(
      aged,
      new Date(now - 2 * reports.MIN_AGE_MS),
      new Date(now - 2 * reports.MIN_AGE_MS),
    );
    fs.utimesSync(
      oldest,
      new Date(now - 3 * reports.MIN_AGE_MS),
      new Date(now - 3 * reports.MIN_AGE_MS),
    );
    fs.utimesSync(
      expired,
      new Date(now - reports.MAX_AGE_MS - 1000),
      new Date(now - reports.MAX_AGE_MS - 1000),
    );
    const result = reports.prunePrivateReports(root, now);
    expect(result.removed).toBe(2);
    expect(result.bytes).toBeLessThanOrEqual(reports.MAX_TOTAL_BYTES);
    expect(fs.existsSync(oldest)).toBe(false);
    expect(fs.existsSync(expired)).toBe(false);
    expect(fs.existsSync(aged)).toBe(true);
    expect(fs.existsSync(recent)).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true);
  });

  it('leaves matching symlinks and files that are locked during deletion', () => {
    const directory = reports.reportDirectory(root, true);
    const now = Date.now();
    const locked = path.join(directory, ownedName('report', '5'));
    const outside = path.join(root, 'outside.html');
    const link = path.join(directory, ownedName('report', '6'));
    fs.writeFileSync(locked, 'PRIVATE');
    fs.writeFileSync(outside, 'foreign');
    fs.utimesSync(
      locked,
      new Date(now - reports.MAX_AGE_MS - 1000),
      new Date(now - reports.MAX_AGE_MS - 1000),
    );
    try {
      fs.symlinkSync(outside, link, 'file');
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    }
    const unlink = fs.unlinkSync;
    vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
      if (target === locked) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return unlink(target);
    });
    const result = reports.prunePrivateReports(root, now);
    expect(result.removed).toBe(0);
    expect(fs.readFileSync(locked, 'utf8')).toBe('PRIVATE');
    expect(fs.readFileSync(outside, 'utf8')).toBe('foreign');
    if (fs.existsSync(link)) expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('bounds each sweep when the report directory is flooded and keeps writes independent', () => {
    const directory = reports.reportDirectory(root, true);
    for (let index = 0; index < 600; index++)
      fs.writeFileSync(path.join(directory, `foreign-${index}.txt`), '');
    const result = reports.prunePrivateReports(root);
    expect(result.scanned).toBe(512);
    expect(result.truncated).toBe(true);

    const old = path.join(directory, ownedName('report', '9'));
    fs.writeFileSync(old, 'PRIVATE');
    fs.utimesSync(old, new Date(0), new Date(0));
    const written = reports.writePrivateReport(root, 'report', 'NEW PRIVATE');
    expect(fs.readFileSync(written, 'utf8')).toBe('NEW PRIVATE');
    expect(fs.existsSync(old)).toBe(true);
  });

  it('rejects a linked report directory and leaves its target untouched', () => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    const directory = path.join(root, 'aegis-private-reports-v1');
    fs.symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => reports.writePrivateReport(root, 'report', 'PRIVATE')).toThrow(
      'Private report directory unavailable',
    );
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('sweeps expired reports at startup and again while the app stays open', () => {
    vi.useFakeTimers();
    const directory = reports.reportDirectory(root, true);
    const now = Date.now();
    const old = path.join(directory, ownedName('report', '7'));
    fs.writeFileSync(old, 'PRIVATE');
    fs.utimesSync(
      old,
      new Date(now - reports.MAX_AGE_MS - 1000),
      new Date(now - reports.MAX_AGE_MS - 1000),
    );
    reports.startPrivateReportRetention(() => root);
    expect(fs.existsSync(old)).toBe(false);

    const later = path.join(directory, ownedName('report', '8'));
    fs.writeFileSync(later, 'PRIVATE');
    fs.utimesSync(
      later,
      new Date(now - reports.MAX_AGE_MS - 1000),
      new Date(now - reports.MAX_AGE_MS - 1000),
    );
    vi.advanceTimersByTime(6 * 60 * 60 * 1000);
    expect(fs.existsSync(later)).toBe(false);
    vi.useRealTimers();
  });
});
