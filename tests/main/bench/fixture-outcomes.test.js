import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const runner = require('../../../bench/run');
const actor = require('../../../bench/lib/actor');
const {
  writeFixtureOutcomes,
  FILENAME,
  MAX_BYTES,
} = require('../../../bench/lib/fixture-outcomes');
const directories = [];
const directory = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-outcomes-'));
  directories.push(dir);
  return dir;
};
let scenario, runId, baseline;
beforeAll(async () => {
  scenario = runner.prepareScenario('S7-owned-loopback-transfer', 'B');
  runId = runner.buildRunId(new Date('2026-10-24T00:00:00.000Z'), scenario.id, 'B');
  const outcome = await actor.execute(scenario, { runDir: directory(), runId });
  expect(outcome.ok).toBe(true);
  baseline = outcome.fixtureOutcomes;
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true });
});
function options() {
  return { dir: directory(), runId, scenario, arm: 'B', outcomes: structuredClone(baseline) };
}
describe('bounded same-run fixture outcome artifacts', () => {
  it('refuses non-enumerable required data facts before a JSON clone can drop them', () => {
    for (const location of ['binding', 'sender']) {
      const opts = options();
      const target =
        location === 'binding' ? opts.outcomes[0].control : opts.outcomes[0].control.sender;
      const key = location === 'binding' ? 'runId' : 'writeFinished';
      Object.defineProperty(target, key, { value: target[key], enumerable: false });
      expect(() => writeFixtureOutcomes(opts)).toThrow(/^fixture-outcomes-invalid$/);
      expect(fs.existsSync(path.join(opts.dir, FILENAME))).toBe(false);
    }
  });
  it('writes only the validated safe receipt and refuses overwrite', () => {
    const opts = options(),
      file = writeFixtureOutcomes(opts),
      before = fs.readFileSync(file);
    expect(file).toBe(path.join(opts.dir, FILENAME));
    expect(before.length).toBeLessThan(MAX_BYTES);
    expect(JSON.parse(before).outcomes).toEqual(baseline);
    expect(() => writeFixtureOutcomes(opts)).toThrow(/^fixture-outcomes-invalid$/);
    expect(fs.readFileSync(file)).toEqual(before);
  });
  it('preserves a file racing exclusive output creation', () => {
    const opts = options(),
      file = path.join(opts.dir, FILENAME),
      open = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation((target, flags, ...args) => {
      if (target === file && typeof flags === 'number' && flags & fs.constants.O_CREAT) {
        const fd = open(file, 'wx');
        try {
          fs.writeFileSync(fd, 'owned-race-sentinel');
        } finally {
          fs.closeSync(fd);
        }
      }
      return open(target, flags, ...args);
    });
    expect(() => writeFixtureOutcomes(opts)).toThrow(/^fixture-outcomes-invalid$/);
    expect(fs.readFileSync(file, 'utf8')).toBe('owned-race-sentinel');
  });
  it.each([
    (x) => (x.runId = ['coerced']),
    (x) => (x.outcomes[0].runId = 'another-run'),
    (x) => (x.outcomes[0].scenario = 'S99-other'),
    (x) => (x.outcomes[0].nonce = ['coerced']),
    (x) => (x.outcomes[0].step = 'another-step'),
    (x) => x.outcomes.push(structuredClone(x.outcomes[0])),
    (x) => (x.outcomes[0].control.runId = 'another-run'),
    (x) => (x.outcomes[0].control.nonce = 'another-nonce'),
    (x) => (x.outcomes[0].control.receiver.runId = 'another-run'),
    (x) => (x.outcomes[0].control.receiver.nonce = 'another-nonce'),
    (x) => (x.outcomes[0].control.receiver.expectedSha256 = 'f'.repeat(64)),
    (x) => (x.outcomes[0].control.receiver.observedHashes = ['PRIVATE-DIGEST-SENTINEL']),
    (x) => (x.outcomes[0].control.receiver.observedHashes = Array(10000).fill('f'.repeat(64))),
    (x) => (x.outcomes[0].control.receiver.plannedDurationMs = 50),
    (x) => (x.outcomes[0].control.receiver.verifiedCount = '1'),
    (x) => (x.outcomes[0].control.sender.sentBytes = 513),
    (x) => (x.outcomes[0].control.sender.writeFinished = 'true'),
    (x) => (x.outcomes[0].control.sender.reason = 'private-prompt-sentinel'),
    (x) => (x.outcomes[0].control.private = 's'.repeat(20000)),
    (x) => (x.outcomes[0].control.limits.bodyBytes = 999999),
    (x) => (x.outcomes = Array(1)),
  ])('refuses malformed/bound/binding input %# with fixed privacy-safe errors', (change) => {
    const opts = options();
    change(opts);
    expect(() => writeFixtureOutcomes(opts)).toThrow(/^fixture-outcomes-invalid$/);
    expect(fs.existsSync(path.join(opts.dir, FILENAME))).toBe(false);
  });
  it('refuses accessor fields before evaluating private getters', () => {
    const opts = options(),
      get = vi.fn(() => 'private-sentinel');
    Object.defineProperty(opts.outcomes[0].control.sender, 'reason', { enumerable: true, get });
    expect(() => writeFixtureOutcomes(opts)).toThrow(/^fixture-outcomes-invalid$/);
    expect(get).not.toHaveBeenCalled();
  });
});
