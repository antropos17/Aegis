import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const runner = require('../../../bench/run');
const actor = require('../../../bench/lib/actor');
const { buildCorpusResults, writeCorpusResults } = require('../../../bench/lib/corpus-results');
const { renderCorpusTable } = require('../../../bench/lib/corpus-table');
const stepAdapter = require('../../../bench/lib/loopback-step');
const { runLoopbackControl } = require('../../../bench/lib/loopback-control');
const childProcess = require('node:child_process');
const directories = [];
const directory = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-results-'));
  directories.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  stepAdapter._resetForTest();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true });
});
let serial = 0;
function manifestFromProducer(opts) {
  const file = require.resolve('../../../bench/lib/manifest'),
    previous = require.cache[file];
  const exec = vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
    throw new Error('private-probe-sentinel');
  });
  try {
    delete require.cache[file];
    return require(file).collect(opts);
  } finally {
    if (previous) require.cache[file] = previous;
    else delete require.cache[file];
    exec.mockRestore();
  }
}
async function recorded(id = 'S3-ordinary-fixture', configure = () => {}) {
  const scenario = runner.prepareScenario(id, 'C'),
    now = new Date(Date.UTC(2026, 9, 24, 0, 0, serial++)),
    runId = runner.buildRunId(now, id, 'C'),
    dir = directory();
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(
      manifestFromProducer({ runId, scenario: id, arm: 'C', startedAt: now.toISOString() }),
    ),
  );
  configure({ scenario, runId, dir });
  const outcome = await actor.execute(scenario, { runDir: dir, runId });
  runner.writeScenarioArtifacts({ dir, runId, scenario, arm: 'C', outcome });
  return { scenario, runId, dir, outcome };
}
function changeJson(item, file, update) {
  const filename = path.join(item.dir, file),
    data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  update(data);
  fs.writeFileSync(filename, JSON.stringify(data));
}
describe('descriptive recorded corpus results', () => {
  it.each([
    [null, null, true],
    [null, 'wrong-receipt', true],
    [null, 'duplicate-receipt', true],
    [null, 'receipt-count-mismatch', true],
    [false, 'wrong-receipt', true],
    [false, 'receipt-count-mismatch', false],
  ])(
    'refuses unpublished receiver tuple exact=%j reason=%j cleanup=%j',
    async (exact, reason, cleanup) => {
      const item = await recorded('S7-owned-loopback-transfer');
      changeJson(item, 'fixture-outcomes.json', (value) => {
        const control = value.outcomes[0].control,
          receiver = control.receiver;
        control.confirmed = false;
        receiver.exact = exact;
        receiver.reason = reason;
        receiver.matchingPayloads = exact === null ? 1 : 0;
        receiver.verifiedCount = exact === null ? null : 0;
        receiver.cleanup.listenerClosed = cleanup;
        receiver.cleanup.confirmed = cleanup;
      });
      expect(() => buildCorpusResults([item.dir], '2026-10-24')).toThrow('corpus-input-invalid');
    },
  );
  it.each(['', '   '])('refuses an empty observed executable %j', async (executable) => {
    const item = await recorded();
    changeJson(item, 'expected.ndjson', (row) => {
      row.process.executable = executable;
    });
    expect(() => buildCorpusResults([item.dir], '2026-10-24')).toThrow('corpus-input-invalid');
  });
  it.each(['S7-owned-loopback-transfer', 'S8-owned-file-read'])(
    'keeps missing steps or catalogue unknown for %s',
    async (id) => {
      const item = await recorded(id);
      fs.unlinkSync(path.join(item.dir, 'steps.json'));
      expect(buildCorpusResults([item.dir], '2026-10-24').attempts[0]).toMatchObject({
        artifactState: 'incomplete',
        stepState: 'unknown',
      });
      fs.unlinkSync(path.join(item.dir, 'expected.ndjson'));
      expect(buildCorpusResults([item.dir], '2026-10-24').attempts[0]).toMatchObject({
        artifactState: 'incomplete',
        expected: null,
      });
    },
  );
  it.each(['sender-failed', 'read-close-failed', 'sender-row-missing', 'read-row-missing'])(
    'reconciles present outcomes and catalogue without steps: %s',
    async (kind) => {
      const read = kind.startsWith('read'),
        item = await recorded(read ? 'S8-owned-file-read' : 'S7-owned-loopback-transfer');
      fs.unlinkSync(path.join(item.dir, 'steps.json'));
      if (kind === 'sender-failed')
        changeJson(item, 'fixture-outcomes.json', (v) => {
          v.outcomes[0].control.sender.writeFinished = false;
        });
      else if (kind === 'read-close-failed')
        changeJson(item, 'file-read-outcomes.json', (v) => {
          const row = v.outcomes[0];
          row.status = 'failed';
          row.reason = 'close-unavailable';
          row.closure.closed = null;
        });
      else {
        const file = path.join(item.dir, 'expected.ndjson'),
          rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
        fs.writeFileSync(file, read ? JSON.stringify(rows[0]) + '\n' : '');
      }
      expect(() => buildCorpusResults([item.dir], '2026-10-24')).toThrow('corpus-input-invalid');
    },
  );
  it.each(['receipt-unconfirmed', 'cleanup-unconfirmed'])(
    'preserves legitimately unknown receiver facts: %s',
    async (reason) => {
      const item = await recorded('S7-owned-loopback-transfer');
      changeJson(item, 'fixture-outcomes.json', (v) => {
        const c = v.outcomes[0].control;
        c.confirmed = false;
        c.receiver.exact = null;
        c.receiver.verifiedCount = null;
        c.receiver.reason = reason;
        if (reason === 'cleanup-unconfirmed') {
          c.receiver.cleanup.listenerClosed = false;
          c.receiver.cleanup.confirmed = false;
        }
      });
      expect(
        buildCorpusResults([item.dir], '2026-10-24').attempts[0].loopback.receiver,
      ).toMatchObject({ exact: null, verifiedCount: null, reason });
    },
  );
  it.each([
    's7-arm',
    's7-run',
    's7-step',
    's7-nonce',
    's7-control-nonce',
    's7-receiver-run',
    's7-bytes',
    's8-arm',
    's8-run',
    's8-step',
    's8-source',
    's8-bytes',
  ])('refuses independent recorded bindings: %s', async (kind) => {
    const read = kind.startsWith('s8'),
      item = await recorded(read ? 'S8-owned-file-read' : 'S7-owned-loopback-transfer');
    if (kind.endsWith('bytes')) {
      const file = path.join(item.dir, 'expected.ndjson'),
        rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse),
        row = rows.at(-1);
      if (read) row.file.size += 1;
      else row.network.bytes += 1;
      fs.writeFileSync(file, rows.map(JSON.stringify).join('\n') + '\n');
    } else
      changeJson(item, read ? 'file-read-outcomes.json' : 'fixture-outcomes.json', (v) => {
        const row = v.outcomes[0];
        if (kind.endsWith('arm')) v.arm = 'B';
        else if (kind.endsWith('control-nonce')) row.control.nonce = 'other-nonce';
        else if (kind.endsWith('receiver-run')) row.control.receiver.runId = 'other-run';
        else if (kind.endsWith('run')) row.runId = 'other-run';
        else if (kind.endsWith('step')) row.step = 'other-step';
        else if (kind.endsWith('source')) row.fromStep = 'other-source';
        else row.nonce = 'other-nonce';
      });
    expect(() => buildCorpusResults([item.dir], '2026-10-24')).toThrow('corpus-input-invalid');
  });
  it('refuses receiver tuples that contradict the actual publish formulas', async () => {
    for (const contradiction of ['false-exact-clean-match', 'confirmed-cleanup-open-listener']) {
      const item = await recorded('S7-owned-loopback-transfer');
      changeJson(item, 'fixture-outcomes.json', (value) => {
        const control = value.outcomes[0].control;
        if (contradiction === 'false-exact-clean-match') {
          control.receiver.exact = false;
          control.confirmed = false;
        } else control.receiver.cleanup.listenerClosed = false;
      });
      expect(() => buildCorpusResults([item.dir], '2026-10-24')).toThrow('corpus-input-invalid');
    }
  });
  it('refuses a successful loopback catalogue with an unavailable control even when steps are missing', async () => {
    const item = await recorded('S7-owned-loopback-transfer');
    fs.unlinkSync(path.join(item.dir, 'steps.json'));
    changeJson(item, 'fixture-outcomes.json', (value) => {
      value.outcomes[0].control = null;
      value.outcomes[0].reason = 'control-unavailable';
    });
    expect(() => buildCorpusResults([item.dir], '2026-10-24')).toThrow('corpus-input-invalid');
  });
  it('accepts successful non-emitting waits without inventing catalogue rows', async () => {
    const item = await recorded('S3-ordinary-fixture', ({ scenario }) =>
      scenario.steps.push({ id: 'after-write', kind: 'wait', with: { ms: 1 } }),
    );
    expect(buildCorpusResults([item.dir], '2026-10-24').attempts[0]).toMatchObject({
      steps: { declared: 2, ok: 2, expectations: { claimed: 1, emitted: 1 } },
      expected: { count: 1 },
    });
  });
  it('refuses sender failure contradicting a recorded successful loopback step', async () => {
    const item = await recorded('S7-owned-loopback-transfer');
    changeJson(item, 'fixture-outcomes.json', (value) => {
      value.outcomes[0].control.sender.writeFinished = false;
    });
    expect(() => buildCorpusResults([item.dir], '2026-10-24')).toThrow('corpus-input-invalid');
  });
  it('binds a complete read to its recorded source creation rather than agreeing forged read facts', async () => {
    const item = await recorded('S8-owned-file-read');
    changeJson(item, 'file-read-outcomes.json', (value) => {
      value.outcomes[0].expectedSha256 = 'f'.repeat(64);
      value.outcomes[0].readSha256 = 'f'.repeat(64);
    });
    const file = path.join(item.dir, 'expected.ndjson'),
      rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
    rows[1].file.hash.sha256 = 'f'.repeat(64);
    fs.writeFileSync(file, rows.map(JSON.stringify).join('\n') + '\n');
    expect(() => buildCorpusResults([item.dir], '2026-10-24')).toThrow('corpus-input-invalid');
  });
  it('refuses oversized output before creating a directory even when individual inputs fit', async () => {
    const item = await recorded(),
      originalManifest = JSON.parse(fs.readFileSync(path.join(item.dir, 'manifest.json'), 'utf8')),
      originalSteps = JSON.parse(fs.readFileSync(path.join(item.dir, 'steps.json'), 'utf8'));
    const dirs = Array.from({ length: 24 }, (_, index) => {
      const dir = directory(),
        runId = `bulk-${index}`,
        steps = structuredClone(originalSteps);
      steps.runId = runId;
      steps.steps.push(
        ...Array.from({ length: 63 }, (_unused, n) => ({
          id: 'wait-' + 'x'.repeat(55) + n,
          kind: 'wait',
          status: 'ok',
          expect: null,
          emits: null,
          emitted: null,
          startedAt: originalManifest.startedAt,
          error: null,
        })),
      );
      steps.counts.declared = 64;
      steps.counts.ok = 64;
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({ ...originalManifest, runId }),
      );
      fs.writeFileSync(path.join(dir, 'steps.json'), JSON.stringify(steps));
      fs.copyFileSync(path.join(item.dir, 'expected.ndjson'), path.join(dir, 'expected.ndjson'));
      return dir;
    });
    const out = path.join(directory(), 'not-created');
    expect(() => writeCorpusResults(dirs, '2026-10-24', out)).toThrow('corpus-input-invalid');
    expect(fs.existsSync(out)).toBe(false);
  });
  it('retains repeated scenarios, deletion, sender/receiver divergence and partial failed reads deterministically', async () => {
    const first = await recorded(),
      repeated = await recorded(),
      deletion = await recorded('S5-disposable-deletion');
    const loopback = await recorded('S7-owned-loopback-transfer', () => {
      stepAdapter._setDepsForTest({
        runLoopbackControl: async (opts) => {
          const result = await runLoopbackControl(opts);
          Object.assign(result.receiver, {
            exact: false,
            verifiedCount: 0,
            matchingPayloads: 0,
            wrong: 1,
            reason: 'wrong-receipt',
            observedHashes: ['f'.repeat(64)],
          });
          result.confirmed = false;
          return result;
        },
      });
    });
    const partial = await recorded('S8-owned-file-read', ({ scenario }) => {
      scenario.steps.push({ id: 'later-wait', kind: 'wait', with: { ms: 1 } });
      const read = fs.readSync;
      vi.spyOn(fs, 'readSync')
        .mockImplementationOnce((fd, bytes, offset, _length, position) =>
          read(fd, bytes, offset, 5, position),
        )
        .mockImplementationOnce(() => {
          throw new Error('private-read-sentinel');
        });
    });
    const dirs = [partial, repeated, loopback, deletion, first].map((item) => item.dir);
    const report = buildCorpusResults(dirs, '2026-10-24'),
      reverse = buildCorpusResults([...dirs].reverse(), '2026-10-24');
    expect(report).toEqual(reverse);
    expect(renderCorpusTable(report)).toBe(renderCorpusTable(reverse));
    expect(report.attempts).toHaveLength(5);
    expect(
      report.inventory.find((row) => row.scenario === first.scenario.id).suppliedAttempts,
    ).toBe(2);
    expect(report.attempts.find((row) => row.runId === deletion.runId).expected).toMatchObject({
      count: 2,
      byCategory: [
        { category: 'file', type: 'creation', count: 1 },
        { category: 'file', type: 'deletion', count: 1 },
      ],
    });
    expect(report.attempts.find((row) => row.runId === loopback.runId).loopback).toMatchObject({
      sender: { writeFinished: true },
      receiver: { exact: false, verifiedCount: 0, reason: 'wrong-receipt' },
    });
    expect(report.attempts.find((row) => row.runId === partial.runId)).toMatchObject({
      artifactState: 'recorded',
      stepState: 'failed',
      steps: { ok: 1, failed: 1, skipped: 1 },
      read: {
        status: 'failed',
        readBytes: 5,
        progressKnown: false,
        reason: 'read-unavailable',
        closure: { closed: true },
      },
    });
    expect(renderCorpusTable(report)).toContain('wrong-receipt');
    expect(renderCorpusTable(report)).toContain('read-unavailable');
  });
  it('writes deterministic fresh JSON and Markdown while excluding decoded private facts', async () => {
    const item = await recorded(),
      eventFile = path.join(item.dir, 'expected.ndjson'),
      event = JSON.parse(fs.readFileSync(eventFile, 'utf8'));
    event.process.executable = 'private-executable-sentinel';
    fs.writeFileSync(eventFile, JSON.stringify(event) + '\n');
    changeJson(item, 'manifest.json', (value) => {
      value.host.private = {
        source: 'private-provenance-sentinel',
        unavailable: 'private-unavailable-sentinel',
      };
    });
    fs.writeFileSync(
      path.join(item.dir, 'metrics.json'),
      '{"accepted":true,"private":"private-metric-sentinel"}',
    );
    fs.writeFileSync(path.join(item.dir, 'oracle-sysmon.ndjson'), JSON.stringify(event));
    const parent = directory(),
      out = path.join(parent, 'one'),
      again = path.join(parent, 'two');
    writeCorpusResults([item.dir], '2026-10-24', out);
    writeCorpusResults([item.dir], '2026-10-24', again);
    for (const file of ['corpus-results.json', 'corpus-results.md'])
      expect(fs.readFileSync(path.join(out, file))).toEqual(
        fs.readFileSync(path.join(again, file)),
      );
    const report = JSON.parse(fs.readFileSync(path.join(out, 'corpus-results.json'), 'utf8')),
      strings = [];
    function collect(value) {
      if (typeof value === 'string') strings.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    }
    collect(report);
    const markdown = fs.readFileSync(path.join(out, 'corpus-results.md'), 'utf8');
    for (const sentinel of [
      'private-executable-sentinel',
      'private-provenance-sentinel',
      'private-unavailable-sentinel',
      'private-probe-sentinel',
      'private-metric-sentinel',
      item.dir,
      item.scenario.steps[0].with.content,
    ]) {
      expect(strings.some((value) => value.includes(sentinel))).toBe(false);
      expect(markdown).not.toContain(sentinel);
    }
    expect(report).toMatchObject({
      scope: 'synthetic-corpus-results',
      captureAssessment: 'not-assessed',
      oracleAdmission: 'not-performed',
      sensorScoring: 'not-performed',
      attackMapping: 'not-performed',
      measurementAccepted: false,
      w8Accepted: false,
    });
    const raw = fs.readFileSync(path.join(item.dir, 'manifest.json'));
    expect(
      report.attempts[0].artifacts.find((row) => row.artifact === 'manifest.json'),
    ).toMatchObject({ bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') });
    for (const module of report.reportImplementation.files)
      expect(module.sha256).toBe(
        createHash('sha256')
          .update(fs.readFileSync(path.resolve(import.meta.dirname, '../../..', module.file)))
          .digest('hex'),
      );
    expect(report.attempts[0].executedDefinitionMatch).toBe('unverified');
  });
  it.each(['steps.json', 'expected.ndjson'])(
    'retains an incomplete attempt when %s is missing',
    async (file) => {
      const item = await recorded();
      fs.unlinkSync(path.join(item.dir, file));
      expect(buildCorpusResults([item.dir], '2026-10-24').attempts[0]).toMatchObject({
        runId: item.runId,
        artifactState: 'incomplete',
        missingArtifacts: [file],
      });
    },
  );
  it('does not confuse missing, valid-empty and skipped outcome states', async () => {
    const item = await recorded('S7-owned-loopback-transfer');
    changeJson(item, 'fixture-outcomes.json', (value) => {
      value.outcomes = [];
    });
    expect(buildCorpusResults([item.dir], '2026-10-24').attempts[0]).toMatchObject({
      artifactState: 'incomplete',
      loopback: { state: 'empty-incomplete' },
    });
    fs.unlinkSync(path.join(item.dir, 'fixture-outcomes.json'));
    expect(buildCorpusResults([item.dir], '2026-10-24').attempts[0]).toMatchObject({
      artifactState: 'incomplete',
      missingArtifacts: ['fixture-outcomes.json'],
      loopback: { state: 'missing' },
    });
    const skipped = await recorded('S7-owned-loopback-transfer', ({ scenario }) => {
      scenario.expect.push({
        id: 'E2',
        description: 'Inert failed fixture',
        category: 'file',
        type: 'creation',
      });
      scenario.steps.unshift({
        id: 'fail-first',
        kind: 'write-fixture',
        expect: 'E2',
        with: { target: 'project', name: 'canary-failed.txt', content: 'public inert\n' },
      });
      vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
        throw new Error('private-write-error-sentinel');
      });
    });
    const row = buildCorpusResults([skipped.dir], '2026-10-24').attempts[0];
    expect(row).toMatchObject({
      artifactState: 'recorded',
      stepState: 'failed',
      steps: { failed: 1, skipped: 1 },
      expected: { count: 0 },
      loopback: { state: 'not-executed' },
    });
    expect(JSON.stringify(row)).not.toContain('private-write-error-sentinel');
  });
  it('retains manifest-only startup refusals as incomplete without claiming capture success', async () => {
    const item = await recorded();
    fs.unlinkSync(path.join(item.dir, 'steps.json'));
    fs.unlinkSync(path.join(item.dir, 'expected.ndjson'));
    fs.writeFileSync(
      path.join(item.dir, 'observed.meta.json'),
      '{"failure":{"reason":"private-startup-error"}}',
    );
    const report = buildCorpusResults([item.dir], '2026-10-24');
    expect(report.attempts[0]).toMatchObject({
      artifactState: 'incomplete',
      stepState: 'unknown',
      steps: null,
      expected: null,
    });
    expect(report.captureAssessment).toBe('not-assessed');
  });
  it.each([
    (x) =>
      changeJson(x, 'steps.json', (v) => {
        v.runId = 'another-run';
      }),
    (x) =>
      changeJson(x, 'steps.json', (v) => {
        v.counts.ok = 0;
      }),
    (x) =>
      changeJson(x, 'steps.json', (v) => {
        v.expectations.emitted = 0;
      }),
    (x) =>
      changeJson(x, 'steps.json', (v) => {
        v.steps[0].status = ['ok'];
      }),
    (x) =>
      changeJson(x, 'steps.json', (v) => {
        v.steps[0].status = 'failed';
        v.steps[0].emitted = null;
        v.counts.ok = 0;
        v.counts.failed = 1;
        v.expectations.emitted = 0;
        v.expectations.notExecuted = 1;
      }),
    (x) =>
      changeJson(x, 'expected.ndjson', (v) => {
        v.bench.expect = 'E99';
      }),
    (x) =>
      changeJson(x, 'expected.ndjson', (v) => {
        v.bench.scenario = 'S4-outside-project';
      }),
    (x) =>
      fs.appendFileSync(
        path.join(x.dir, 'expected.ndjson'),
        fs.readFileSync(path.join(x.dir, 'expected.ndjson')),
      ),
    (x) => fs.writeFileSync(path.join(x.dir, 'expected.ndjson'), ''),
    (x) =>
      changeJson(x, 'manifest.json', (v) => {
        v.schemaVersion = 999;
      }),
    (x) => fs.unlinkSync(path.join(x.dir, 'manifest.json')),
  ])('refuses malformed or contradictory recorded artifacts %#', async (change) => {
    const item = await recorded();
    change(item);
    expect(() => buildCorpusResults([item.dir], '2026-10-24')).toThrow('corpus-input-invalid');
  });
  it('refuses duplicate run IDs even across distinct supplied directories', async () => {
    const item = await recorded(),
      other = directory();
    for (const file of ['manifest.json', 'steps.json', 'expected.ndjson'])
      fs.copyFileSync(path.join(item.dir, file), path.join(other, file));
    expect(() => buildCorpusResults([item.dir, other], '2026-10-24')).toThrow(
      'corpus-input-invalid',
    );
  });
  it('rejects nested array category coercion instead of accepting a malformed catalogue', async () => {
    const item = await recorded(),
      file = path.join(item.dir, 'expected.ndjson'),
      event = JSON.parse(fs.readFileSync(file, 'utf8'));
    event.event.category = [['file']];
    fs.writeFileSync(file, JSON.stringify(event) + '\n');
    expect(() => buildCorpusResults([item.dir], '2026-10-24')).toThrow('corpus-input-invalid');
  });
  it('summarizes actual S3 actor/writer artifacts and leaves unsupplied inventory pending', async () => {
    const item = await recorded(),
      report = buildCorpusResults([item.dir], '2026-10-24');
    expect(report.attempts).toHaveLength(1);
    expect(report.attempts[0]).toMatchObject({
      runId: item.runId,
      scenario: item.scenario.id,
      artifactState: 'recorded',
      stepState: 'ok',
      steps: { declared: 1, ok: 1, failed: 0, skipped: 0 },
      expected: { count: 1, byCategory: [{ category: 'file', type: 'creation', count: 1 }] },
      executedDefinitionMatch: 'unverified',
    });
    expect(report.inventory.filter((row) => row.status === 'pending')).toHaveLength(5);
  });
});
