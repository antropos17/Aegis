import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBundle, cleanup, readJson, writeJson, restamp } from './resource-replay-fixtures.js';
const require = createRequire(import.meta.url);
const replay = require('../../../bench/lib/resource-replay');
const current = require('../../../bench/lib/resource-replay-current');
const { hash } = require('../../../bench/lib/resource-replay-json');
afterEach(cleanup);
const inspect = (fixture, name = 'report') =>
  replay.inspectResourceReplay({ input: fixture.input, out: path.join(fixture.parent, name) });
describe('offline eight-file resource consistency (CI only)', () => {
  it('consumes actual injected producers, preserves input bytes and deterministically replays the entire result', async () => {
    const fixture = await createBundle();
    expect(fixture.producerResult.exitCode).toBe(0);
    const first = inspect(fixture),
      second = inspect(fixture, 'second');
    expect(first.exitCode).toBe(0);
    expect(first.report).toMatchObject({
      classification: 'consistent-for-conditional-replay',
      runId: 'replay-fixture',
      parentFinalPublication: 'unknown',
      childFinalPublication: 'unknown',
      reportedChildPublicationSupport: 'supported-by-reported-lifecycle',
      historical: { executionMode: 'injected', readingMode: 'injected', sourceAlignment: 'match' },
      replay: { state: 'recomputed', storedDerivedCompared: true, entireStoredResultEqual: true },
      sourceAuthenticated: false,
      measurementAccepted: false,
      w8Accepted: false,
    });
    expect(first.report.input.files).toHaveLength(8);
    let bytes = 0;
    for (const file of first.report.input.files) {
      const actual = fs.readFileSync(path.join(fixture.input, file.file));
      bytes += actual.length;
      expect(file).toEqual({
        file: file.file,
        sha256: hash(actual),
        byteLength: actual.length,
        closed: true,
      });
    }
    expect(first.report.input.bytes).toBe(bytes);
    expect(second.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(fixture.parent, 'report/resource-replay.json'))).toEqual(
      fs.readFileSync(path.join(fixture.parent, 'second/resource-replay.json')),
    );
  });
  it.each([1000, 60000])(
    'retains the fixed %i ms grid including zero intervals or an artifact beyond 64KiB',
    async (durationMs) => {
      const fixture = await createBundle({ durationMs }),
        result = inspect(fixture);
      expect(result.exitCode).toBe(0);
      expect(result.report.acquisition.plannedPoints).toBe(durationMs / 1000);
      expect(result.report.exclusions.cpu).toHaveLength(durationMs / 1000 - 1);
      if (durationMs === 60000)
        expect(
          fs.statSync(path.join(fixture.input, 'capture/bracketed-intervals.json')).size,
        ).toBeGreaterThan(65536);
    },
  );
  it('preserves cancelled acquisition and its entirely unattempted tail without promoting current arithmetic agreement', async () => {
    const fixture = await createBundle({ cancelled: true }),
      result = inspect(fixture);
    expect(result.exitCode).toBe(3);
    expect(result.report).toMatchObject({
      classification: 'incomplete',
      reportedChildPublicationSupport: 'not-supported',
      acquisition: {
        complete: false,
        observedPoints: 0,
        unattemptedPoints: 3,
        stopReason: 'cancelled',
      },
      replay: { entireStoredResultEqual: true },
    });
  });
  it.each(['hash', 'length'])(
    'keeps historical evaluator %s drift orthogonal to current arithmetic',
    async (kind) => {
      const fixture = await createBundle();
      for (const file of ['supervision-plan.json', 'capture/session-plan.json'])
        writeJson(fixture.input, file, (v) => {
          const entry = v.sources.files.at(-1);
          if (kind === 'hash') entry.sha256 = '0'.repeat(64);
          else entry.byteLength++;
        });
      for (const file of ['supervision-final.json', 'capture/session-final.json'])
        writeJson(fixture.input, file, (v) => {
          const entry = v.sources.after.files.at(-1);
          if (kind === 'hash') entry.sha256 = '0'.repeat(64);
          else entry.byteLength++;
        });
      restamp(fixture.input);
      const result = inspect(fixture);
      expect(result.exitCode).toBe(0);
      expect(result.report.current.evaluator.historicalComparison).toBe('different');
      expect(result.report.historical.evaluator).toMatchObject({
        file: 'bench/lib/bracketed-resource-intervals.js',
        basis: 'child-plan-declaration',
        sourceAuthenticated: false,
      });
      expect(result.report.replay.entireStoredResultEqual).toBe(true);
      expect(result.report.measurementAccepted).toBe(false);
    },
  );
  it('labels current evaluator unavailability and still gives present contradictions precedence', async () => {
    const fixture = await createBundle();
    vi.spyOn(current, 'evaluator').mockReturnValue(null);
    expect(inspect(fixture).exitCode).toBe(7);
    fs.unlinkSync(path.join(fixture.input, 'capture/raw-samples.json'));
    writeJson(fixture.input, 'capture/session-final.json', (v) => {
      v.w8Accepted = true;
    });
    expect(inspect(fixture, 'refused').exitCode).toBe(4);
  });
  it('rejects malformed present JSON despite a missing different artifact', async () => {
    const fixture = await createBundle();
    fs.unlinkSync(path.join(fixture.input, 'capture/raw-samples.json'));
    fs.writeFileSync(
      path.join(fixture.input, 'supervision-pending.json'),
      '{"private":"unterminated',
    );
    const result = inspect(fixture);
    expect(result.exitCode).toBe(4);
    expect(JSON.stringify(result.report)).not.toContain('unterminated');
    expect(readJson(fixture.input, 'capture/session-final.json').measurementAccepted).toBe(false);
  });
  it.each(['getter', 'prototype', 'extra'])('refuses API %s before filesystem activity', (kind) => {
    const options = { input: path.resolve('private-input'), out: path.resolve('private-output') };
    let getters = 0;
    if (kind === 'getter')
      Object.defineProperty(options, 'input', {
        enumerable: true,
        get() {
          getters++;
          return 'private-value';
        },
      });
    if (kind === 'prototype') Object.setPrototypeOf(options, { inherited: true });
    if (kind === 'extra') options.command = 'private-command';
    const inspectFiles = vi.spyOn(fs, 'lstatSync');
    expect(replay.inspectResourceReplay(options)).toEqual({ exitCode: 2, report: null });
    expect(getters).toBe(0);
    expect(inspectFiles).not.toHaveBeenCalled();
  });
  it.each(['missing', 'linked'])(
    'distinguishes a %s capture directory before fixed file access',
    async (mode) => {
      const fixture = await createBundle(),
        capture = path.join(fixture.input, 'capture'),
        moved = path.join(fixture.parent, 'retained-capture');
      expect(path.relative(fixture.parent, capture).startsWith('..')).toBe(false);
      expect(path.relative(fixture.parent, moved).startsWith('..')).toBe(false);
      fs.renameSync(capture, moved);
      if (mode === 'linked') fs.symlinkSync(moved, capture, 'junction');
      const result = inspect(fixture);
      expect(result.exitCode).toBe(mode === 'missing' ? 3 : 4);
      if (mode === 'missing') expect(result.report.input.missing).toHaveLength(5);
    },
  );
  it('records implementation endpoint drift as unavailable without claiming the loaded source is authenticated', async () => {
    const fixture = await createBundle(),
      inventory = current.inventory;
    let count = 0;
    vi.spyOn(current, 'inventory').mockImplementation(() => {
      const value = inventory();
      if (++count > 1) value.files[0].sha256 = 'f'.repeat(64);
      return value;
    });
    const result = inspect(fixture);
    expect(result.exitCode).toBe(7);
    expect(result.report.current.sources.state).toBe('changed');
    expect(result.report.current.evaluator.loadedCodeAuthenticated).toBe(false);
  });
  it('returns publication failure even if its final report parses after an uncertain close', async () => {
    const fixture = await createBundle(),
      target = path.join(fixture.parent, 'report/resource-replay.json'),
      open = fs.openSync,
      close = fs.closeSync;
    let reportFd,
      failed = false;
    vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
      const fd = open(file, ...args);
      if (file === target) reportFd = fd;
      return fd;
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      close(fd);
      if (fd === reportFd && !failed) {
        failed = true;
        throw Error('private-close-error');
      }
    });
    const result = inspect(fixture);
    expect(result.exitCode).toBe(6);
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).finalPublication).toBe('not-self-attested');
  });
});
