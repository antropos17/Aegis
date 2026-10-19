import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const {
  evaluateTaskFalseAlarms: evaluate,
  hashTaskEvidence: hash,
} = require('../../../bench/lib/task-false-alarms.js');
const SOURCE = 'a'.repeat(64);
function seal(e) {
  e.hashes.rubricSha256 = hash(e.rubric);
  e.hashes.rosterSha256 = hash(e.roster);
  e.collection.rosterSha256 = e.hashes.rosterSha256;
  e.collection.rubricSha256 = e.hashes.rubricSha256;
  e.hashes.collectionSha256 = hash(e.collection);
  e.adjudication.collectionSha256 = e.hashes.collectionSha256;
  e.hashes.adjudicationSha256 = hash(e.adjudication);
  return e;
}
function fixture() {
  const tasks = ['completed', 'failed', 'refused', 'timed-out'].map((outcome, i) => ({
    taskId: 't' + i,
    outcome,
    alarmInventoryComplete: true,
    coverage: [{ startMs: 1000, endMs: 3601000, lostAlarms: 0 }],
    alarms: [],
  }));
  return seal({
    version: 'task-false-alarms/1',
    runId: 'run1',
    sourceSha256: SOURCE,
    evidenceKind: 'synthetic',
    units: { time: 'monotonic-ms', exposure: 'hours' },
    rubric: {
      version: 'task-false-alarm-rubric/1',
      frozenAtMs: 0,
      eligibility: 'started-ordinary-benign',
      alarm: 'user-visible-security-alarm',
      dedup: 'same-task-alarm-key',
      adjudication: 'independent-evidence',
    },
    roster: {
      runId: 'run1',
      sourceSha256: SOURCE,
      sealedAtMs: 1000,
      startedCount: 4,
      tasks: tasks.map((t) => ({
        taskId: t.taskId,
        eligibility: 'ordinary-benign',
        startedMs: 1000,
        window: { startMs: 1000, endMs: 3601000 },
      })),
    },
    collection: {
      runId: 'run1',
      sourceSha256: SOURCE,
      collectorId: 'collector1',
      alarmSourceId: 'alarms1',
      rosterSha256: '',
      rubricSha256: '',
      taskCount: 4,
      alarmCount: 0,
      tasks,
    },
    adjudication: {
      runId: 'run1',
      sourceSha256: SOURCE,
      adjudicatorId: 'reviewer1',
      oracleSourceId: 'oracle1',
      independence: 'independent-of-alarm-source',
      evidenceSha256: 'b'.repeat(64),
      collectionSha256: '',
      decisionCount: 0,
      decisions: [],
    },
    hashes: {},
  });
}
function alarm(e, task, key, verdict = 'false-alarm') {
  e.collection.tasks[task].alarms.push({
    alarmId: 'a' + e.collection.alarmCount++,
    alarmKey: key,
    atMs: 2000,
  });
  if (!e.adjudication.decisions.some((d) => d.taskId === 't' + task && d.alarmKey === key)) {
    e.adjudication.decisions.push({ taskId: 't' + task, alarmKey: key, verdict });
    e.adjudication.decisionCount++;
  }
  return seal(e);
}
const invalid = (e) => expect(() => evaluate(e)).toThrow(/^task-false-alarms-input-invalid$/);
let temp;
afterEach(() => {
  if (!temp) return;
  const base = path.resolve(os.tmpdir()) + path.sep;
  if (!temp.startsWith(base) || fs.lstatSync(temp).isSymbolicLink())
    throw new Error('unsafe-test-cleanup');
  for (const name of fs.readdirSync(temp)) {
    const entry = path.join(temp, name),
      stat = fs.lstatSync(entry);
    if (stat.isSymbolicLink()) fs.rmSync(entry);
    else if (stat.isFile()) fs.unlinkSync(entry);
    else throw new Error('unexpected-test-directory');
  }
  fs.rmdirSync(temp);
  temp = undefined;
});
function cli(args) {
  return spawnSync(process.execPath, [path.resolve('bench/task-false-alarms.cjs'), ...args], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 16384,
    windowsHide: true,
  });
}
function files(e = fixture()) {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-task-fa-'));
  const input = path.join(temp, 'evidence.json'),
    output = path.join(temp, 'result.json');
  fs.writeFileSync(input, JSON.stringify(e), { flag: 'wx' });
  return { input, output, args: ['--input', input, '--output', output] };
}

describe('offline started-task false alarms', () => {
  it('counts tasks once, retains failed/refused/timed-out tasks, and separates genuine alarms', () => {
    const e = fixture();
    alarm(e, 0, 'k1');
    alarm(e, 0, 'k1');
    alarm(e, 0, 'k2');
    alarm(e, 1, 'k3');
    alarm(e, 2, 'k4', 'genuine');
    const before = structuredClone(e),
      r = evaluate(e);
    expect(r.incidence).toEqual({
      value: 0.5,
      unit: 'fraction-of-eligible-started-tasks',
      numerator: 2,
      denominator: 4,
      reason: null,
    });
    expect(r.counts).toMatchObject({
      started: 4,
      eligible: 4,
      completeEligible: 4,
      incompleteEligible: 0,
      rawAlarms: 5,
      distinctAlarms: 4,
      falseAlarms: 3,
      genuineAlarms: 1,
    });
    expect(r.tasks.map((t) => t.outcome)).toEqual(['completed', 'failed', 'refused', 'timed-out']);
    expect(r.exposure.eligibleObservedHours).toBe(4);
    expect(r.tasks[0]).toMatchObject({
      rawAlarmCount: 3,
      distinctAlarmCount: 2,
      falseAlarmCount: 2,
      hasFalseAlarm: true,
    });
    expect(r.evidence).toEqual(e);
    expect(e).toEqual(before);
    r.evidence.roster.tasks.pop();
    expect(e.roster.tasks).toHaveLength(4);
    expect(JSON.stringify(evaluate(e))).toBe(JSON.stringify(evaluate(e)));
  });
  it('admits zero only with complete observed exposure and complete alarm inventories', () => {
    const r = evaluate(fixture());
    expect(r.incidence).toMatchObject({ value: 0, numerator: 0, denominator: 4, reason: null });
    expect(r.tasks.every((t) => t.complete && t.hasFalseAlarm === false)).toBe(true);
    expect(r.exposure.eligibleScheduledHours).toBe(4);
  });
  it.each(['excluded-nonordinary', 'excluded-nonbenign'])(
    'uses frozen eligibility %s independently of outcomes',
    (eligibility) => {
      const e = alarm(fixture(), 0, 'k1');
      e.roster.tasks[0].eligibility = eligibility;
      // An excluded task remains visible even when its collection is incomplete.
      e.collection.tasks[0].alarmInventoryComplete = false;
      const r = evaluate(seal(e));
      expect(r.incidence).toMatchObject({ value: 0, numerator: 0, denominator: 3, reason: null });
      expect(r.counts).toMatchObject({ started: 4, eligible: 3, excluded: 1, falseAlarms: 1 });
      expect(r.tasks).toHaveLength(4);
    },
  );
  it.each([
    [
      'leading gap',
      (t) => {
        t.coverage[0].startMs++;
      },
    ],
    [
      'trailing gap',
      (t) => {
        t.coverage[0].endMs--;
      },
    ],
    [
      'interior gap',
      (t) => {
        t.coverage = [
          { startMs: 1000, endMs: 2000, lostAlarms: 0 },
          { startMs: 3000, endMs: 3601000, lostAlarms: 0 },
        ];
      },
    ],
    [
      'lost alarm',
      (t) => {
        t.coverage[0].lostAlarms = 1;
      },
    ],
    [
      'unknown loss',
      (t) => {
        t.coverage[0].lostAlarms = null;
      },
    ],
    [
      'missing windows',
      (t) => {
        t.coverage = [];
      },
    ],
    [
      'inventory incomplete',
      (t) => {
        t.alarmInventoryComplete = false;
      },
    ],
  ])('refuses overall incidence for %s without denominator deletion', (_name, edit) => {
    const e = alarm(fixture(), 0, 'k1');
    edit(e.collection.tasks[3]);
    const r = evaluate(seal(e));
    expect(r.incidence).toMatchObject({
      value: null,
      numerator: 1,
      denominator: 4,
      reason: 'incomplete-eligible-cohort',
    });
    expect(r.counts).toMatchObject({ eligible: 4, completeEligible: 3, incompleteEligible: 1 });
    expect(r.tasks[3].hasFalseAlarm).toBeNull();
    expect(r.tasks.map((t) => t.outcome)).toEqual(['completed', 'failed', 'refused', 'timed-out']);
  });
  it('keeps known false alarms visible even when their task observation is incomplete', () => {
    const e = alarm(fixture(), 1, 'k1');
    e.collection.tasks[1].alarmInventoryComplete = false;
    const r = evaluate(seal(e));
    expect(r.incidence.value).toBeNull();
    expect(r.incidence.numerator).toBe(1);
    expect(r.tasks[1].hasFalseAlarm).toBe(true);
  });
  it('distinguishes empty cohort from empty exposure', () => {
    const e = fixture();
    e.collection.tasks.forEach((t) => {
      t.coverage = [];
    });
    const r = evaluate(seal(e));
    expect(r.incidence).toMatchObject({
      value: null,
      denominator: 4,
      reason: 'empty-eligible-exposure',
    });
    expect(r.tasks.every((t) => t.reasons.includes('unobserved'))).toBe(true);
    e.roster.tasks = [];
    e.roster.startedCount = 0;
    e.collection.tasks = [];
    e.collection.taskCount = 0;
    expect(evaluate(seal(e)).incidence).toMatchObject({
      value: null,
      denominator: 0,
      reason: 'empty-eligible-cohort',
    });
  });
  it('accepts adjacent complete windows and keeps duplicate keys task-local', () => {
    const e = alarm(alarm(fixture(), 0, 'shared'), 1, 'shared', 'genuine');
    e.collection.tasks[3].coverage = [
      { startMs: 1000, endMs: 2000, lostAlarms: 0 },
      { startMs: 2000, endMs: 3601000, lostAlarms: 0 },
    ];
    expect(evaluate(seal(e)).incidence.value).toBe(0.25);
  });
  it.each([
    [
      'duplicate roster ID',
      (e) => {
        e.roster.tasks[1].taskId = 't0';
      },
    ],
    [
      'duplicate collected task',
      (e) => {
        e.collection.tasks[1].taskId = 't0';
      },
    ],
    [
      'deleted denominator task',
      (e) => {
        e.collection.tasks.pop();
        e.collection.taskCount--;
      },
    ],
    [
      'contradictory roster count',
      (e) => {
        e.roster.startedCount--;
      },
    ],
    [
      'contradictory alarm count',
      (e) => {
        e.collection.alarmCount++;
      },
    ],
    [
      'foreign task',
      (e) => {
        e.collection.tasks[0].taskId = 'foreign';
      },
    ],
    [
      'foreign run',
      (e) => {
        e.collection.runId = 'other-run';
      },
    ],
    [
      'foreign source',
      (e) => {
        e.adjudication.sourceSha256 = 'c'.repeat(64);
      },
    ],
    [
      'late rubric freeze',
      (e) => {
        e.rubric.frozenAtMs = 1000;
      },
    ],
    [
      'roster seal before actual start',
      (e) => {
        e.roster.sealedAtMs = 999;
      },
    ],
    [
      'obsolete prospective roster freeze',
      (e) => {
        delete e.roster.sealedAtMs;
        e.roster.frozenAtMs = 0;
      },
    ],
    [
      'shrunk scheduled start',
      (e) => {
        e.roster.tasks[0].window.startMs++;
      },
    ],
    [
      'unknown eligibility',
      (e) => {
        e.roster.tasks[0].eligibility = 'successful';
      },
    ],
    [
      'unknown outcome',
      (e) => {
        e.collection.tasks[0].outcome = 'skipped';
      },
    ],
    [
      'unknown field',
      (e) => {
        e.collection.tasks[0].prompt = 'private';
      },
    ],
    [
      'invalid ID',
      (e) => {
        e.roster.tasks[0].taskId = '../private';
      },
    ],
    [
      'same observer',
      (e) => {
        e.adjudication.adjudicatorId = e.collection.collectorId;
      },
    ],
    [
      'same source',
      (e) => {
        e.adjudication.oracleSourceId = e.collection.alarmSourceId;
      },
    ],
    [
      'overlapping coverage',
      (e) => {
        e.collection.tasks[0].coverage.push({ startMs: 2000, endMs: 4000, lostAlarms: 0 });
      },
    ],
    [
      'outside coverage',
      (e) => {
        e.collection.tasks[0].coverage[0].endMs++;
      },
    ],
    [
      'missing exposure',
      (e) => {
        delete e.collection.tasks[0].coverage;
      },
    ],
    [
      'zero schedule',
      (e) => {
        e.roster.tasks[0].window.endMs = 1000;
      },
    ],
    [
      'malformed row',
      (e) => {
        e.collection.tasks[0] = null;
      },
    ],
  ])('rejects %s with fixed error', (_name, edit) => {
    const e = fixture();
    edit(e);
    invalid(seal(e));
  });
  it.each([
    [
      'missing adjudication',
      (e) => {
        e.adjudication.decisions = [];
        e.adjudication.decisionCount = 0;
      },
    ],
    [
      'unresolved adjudication',
      (e) => {
        e.adjudication.decisions[0].verdict = 'unresolved';
      },
    ],
    [
      'duplicate adjudication',
      (e) => {
        e.adjudication.decisions.push({ ...e.adjudication.decisions[0] });
        e.adjudication.decisionCount++;
      },
    ],
    [
      'foreign adjudication',
      (e) => {
        e.adjudication.decisions[0].taskId = 'foreign';
      },
    ],
    [
      'unused adjudication',
      (e) => {
        e.adjudication.decisions[0].alarmKey = 'unused';
      },
    ],
    [
      'duplicate alarm ID',
      (e) => {
        e.collection.tasks[0].alarms.push({ ...e.collection.tasks[0].alarms[0] });
        e.collection.alarmCount++;
      },
    ],
    [
      'unobserved alarm',
      (e) => {
        e.collection.tasks[0].alarms[0].atMs = 3601000;
      },
    ],
    [
      'contradictory decision count',
      (e) => {
        e.adjudication.decisionCount++;
      },
    ],
  ])('rejects %s rather than inventing a verdict', (_name, edit) => {
    const e = alarm(fixture(), 0, 'k1');
    edit(e);
    invalid(seal(e));
  });
  it('detects changed sealed evidence and enforces closed binding hashes', () => {
    const e = fixture();
    e.collection.tasks[0].outcome = 'failed';
    invalid(e);
    seal(e);
    e.collection.rosterSha256 = 'c'.repeat(64);
    e.hashes.collectionSha256 = hash(e.collection);
    e.adjudication.collectionSha256 = e.hashes.collectionSha256;
    e.hashes.adjudicationSha256 = hash(e.adjudication);
    invalid(e);
  });
  it('accepts staggered actual starts sealed after the final start under a pre-run rubric', () => {
    const e = fixture();
    e.roster.tasks.forEach((t, i) => {
      const start = 1000 + i * 5000;
      t.startedMs = start;
      t.window = { startMs: start, endMs: start + 3600000 };
      e.collection.tasks[i].coverage = [{ ...t.window, lostAlarms: 0 }];
    });
    e.roster.sealedAtMs = 16001;
    const r = evaluate(seal(e));
    expect(r.evidence.roster.tasks.map((t) => t.startedMs)).toEqual([1000, 6000, 11000, 16000]);
    expect(r.evidence.roster.sealedAtMs).toBe(16001);
    expect(r.incidence).toMatchObject({ value: 0, denominator: 4, reason: null });
    expect(r.exposure.eligibleObservedHours).toBe(4);
  });
  it('bounds plain JSON before copying and refuses unsafe arithmetic/accessors', () => {
    for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
      const e = fixture();
      e.roster.tasks[0].startedMs = value;
      invalid(e);
    }
    const e = fixture();
    Object.defineProperty(e.collection, 'tasks', {
      enumerable: true,
      get: () => {
        throw new Error('secret-getter');
      },
    });
    invalid(e);
    expect(() => hash({ long: 'x'.repeat(129) })).toThrow('task-false-alarms-input-invalid');
    let nested = {};
    for (let i = 0; i < 14; i++) nested = { nested };
    expect(() => hash(nested)).toThrow('task-false-alarms-input-invalid');
    expect(() => hash(Array(2))).toThrow('task-false-alarms-input-invalid');
    const hidden = fixture();
    Object.defineProperty(hidden, 'length', { value: 1, enumerable: false });
    invalid(hidden);
  });
  it('enforces task, row, node and byte budgets rather than truncating a cohort', () => {
    const e = fixture();
    e.roster.tasks = Array.from({ length: 513 }, () => ({ ...e.roster.tasks[0] }));
    e.roster.startedCount = 513;
    invalid(seal(e));
    expect(() => hash(Array(8193).fill(null))).toThrow('task-false-alarms-input-invalid');
    expect(() => hash(Array.from({ length: 7 }, () => Array(8192).fill(null)))).toThrow(
      'task-false-alarms-input-invalid',
    );
    expect(() =>
      hash(Object.fromEntries(Array.from({ length: 8192 }, (_, i) => ['k' + i, 'x'.repeat(128)]))),
    ).toThrow('task-false-alarms-input-invalid');
  });
  it('retains an entirely excluded cohort with a null eligible incidence', () => {
    const e = fixture();
    e.roster.tasks.forEach((t) => {
      t.eligibility = 'excluded-nonordinary';
    });
    const r = evaluate(seal(e));
    expect(r.counts).toMatchObject({ started: 4, eligible: 0, excluded: 4 });
    expect(r.incidence).toMatchObject({
      value: null,
      denominator: 0,
      reason: 'empty-eligible-cohort',
    });
    expect(r.tasks).toHaveLength(4);
  });
});

describe('explicit evidence CLI', () => {
  it('writes deterministic fresh JSON with an honest null status and preserves the input', () => {
    const e = fixture();
    e.collection.tasks[3].coverage = [];
    const f = files(seal(e)),
      before = fs.readFileSync(f.input);
    const first = cli(f.args);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toEqual({
      status: 'written',
      reason: 'incomplete-eligible-cohort',
    });
    const result = fs.readFileSync(f.output, 'utf8');
    expect(JSON.parse(result).incidence.denominator).toBe(4);
    const second = cli(['--input', f.input, '--output', path.join(temp, 'second.json')]);
    expect(second.status).toBe(0);
    expect(fs.readFileSync(path.join(temp, 'second.json'), 'utf8')).toBe(result);
    const collision = cli(f.args);
    expect(collision.status).toBe(5);
    expect(collision.stderr).toBe('task-false-alarms: output-path\n');
    expect(fs.readFileSync(f.output, 'utf8')).toBe(result);
    expect(fs.readFileSync(f.input)).toEqual(before);
  });
  it('has readable help and refuses ambiguous arguments', () => {
    const help = cli(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('task-false-alarms/1');
    expect(help.stdout).toContain('monotonic milliseconds');
    expect(cli([]).status).toBe(2);
    expect(cli(['--help', '--private']).stderr).toBe('task-false-alarms: usage\n');
  });
  it.each([
    '{"private":"DO-NOT-LEAK"',
    '{"version":1,"version":2}',
    '['.repeat(14) + ']'.repeat(14),
    '\ufffd',
    ' '.repeat(1048577),
  ])('bounds malformed input and sanitizes all errors', (text) => {
    const f = files();
    fs.writeFileSync(f.input, text);
    const run = cli(f.args);
    expect([3, 4]).toContain(run.status);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(/^task-false-alarms: input-(path|invalid)\n$/);
    expect(fs.existsSync(f.output)).toBe(false);
  });
  it('refuses input and output through a junction/symlink parent', () => {
    const f = files(),
      alias = path.join(temp, 'alias');
    fs.symlinkSync(temp, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(cli(['--input', path.join(alias, 'evidence.json'), '--output', f.output]).status).toBe(
      3,
    );
    expect(cli(['--input', f.input, '--output', path.join(alias, 'new.json')]).status).toBe(5);
    expect(fs.existsSync(path.join(temp, 'new.json'))).toBe(false);
  });
});
