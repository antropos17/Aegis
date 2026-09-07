/**
 * @file tests/main/bench/score.test.js
 * @description The gate on `bench/score.js` — the entrypoint that turns one run
 *   directory into `matched.ndjson` and `metrics.json`.
 *
 *   `bench/lib/metrics.js` owns the arithmetic and is gated next door in
 *   `metrics.test.js`. What this file pins is everything around it: which files a
 *   directory must hold, which disagreements between them are refused with nothing
 *   written, which absences are a written result rather than a refusal, the exit
 *   code each of those carries, and the rule that a recorded score is compared
 *   against and never overwritten.
 *
 *   The inputs are the DERIVED models under `tests/fixtures/bench/derived/M*` —
 *   hand-written directories, not recordings. Nothing here is an accuracy figure
 *   about the AEGIS sensor.
 */
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import metrics from '../../../bench/lib/metrics.js';
import score from '../../../bench/score.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const DERIVED = path.join(REPO, 'tests', 'fixtures', 'bench', 'derived');

/** @type {string} */
let tmp;
/** @type {string[]} */
let out;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-bench-score-test-'));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((line) => out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line) => out.push(String(line)));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Copy one derived model into the throwaway directory, so a test may edit it.
 * The committed fixture is never written to.
 * @param {string} id - A directory under `tests/fixtures/bench/derived/`.
 * @param {string} [as] - Name inside the temp directory.
 * @returns {string} The copy's absolute path.
 */
function stage(id, as = id) {
  const target = path.join(tmp, as);
  fs.cpSync(path.join(DERIVED, id), target, { recursive: true });
  return target;
}

/**
 * Rewrite one JSON file inside a staged copy.
 * @param {string} dir
 * @param {string} name
 * @param {function(Object): Object} edit
 * @returns {void}
 */
function patch(dir, name, edit) {
  const file = path.join(dir, name);
  const value = edit(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** @param {string[]} lines @returns {string} */
const said = (lines) => lines.join('\n');

describe('bench/score.js — scoring a run directory', () => {
  it('writes both artefacts for each derived model and exits 0', () => {
    for (const id of ['M1-fully-confirmed', 'M2-unconfirmed-rows', 'M3-category-unmeasurable']) {
      const target = path.join(tmp, `out-${id}`);
      expect(score.main([path.join(DERIVED, id), '--out', target])).toBe(0);
      for (const name of [metrics.MATCHED_FILENAME, metrics.METRICS_FILENAME]) {
        expect(fs.existsSync(path.join(target, name))).toBe(true);
      }
      const written = JSON.parse(fs.readFileSync(path.join(target, metrics.METRICS_FILENAME), 'utf8'));
      expect(written.schemaVersion).toBe(metrics.METRICS_SCHEMA_VERSION);
      expect(written.runId).toBe(`DERIVED-${id}`);
    }
  });

  it('leaves the committed fixture untouched when --out is given', () => {
    const before = fs.readdirSync(path.join(DERIVED, 'M1-fully-confirmed')).sort();
    score.main([path.join(DERIVED, 'M1-fully-confirmed'), '--out', path.join(tmp, 'elsewhere')]);
    expect(fs.readdirSync(path.join(DERIVED, 'M1-fully-confirmed')).sort()).toEqual(before);
    expect(before).not.toContain(metrics.METRICS_FILENAME);
  });

  it('scores the same directory to the same bytes twice — no instant of scoring reaches it', () => {
    const source = path.join(DERIVED, 'M2-unconfirmed-rows');
    const first = path.join(tmp, 'a');
    const second = path.join(tmp, 'b');
    expect(score.main([source, '--out', first])).toBe(0);
    expect(score.main([source, '--out', second])).toBe(0);
    for (const name of [metrics.MATCHED_FILENAME, metrics.METRICS_FILENAME]) {
      expect(fs.readFileSync(path.join(first, name), 'utf8')).toBe(
        fs.readFileSync(path.join(second, name), 'utf8'),
      );
    }
  });

  it('records the provenance of every file it read, as digests and never as mtimes', () => {
    const target = path.join(tmp, 'p');
    score.main([path.join(DERIVED, 'M1-fully-confirmed'), '--out', target]);
    const written = JSON.parse(fs.readFileSync(path.join(target, metrics.METRICS_FILENAME), 'utf8'));
    expect(written.inputs.map((input) => input.name).sort()).toEqual([
      'expected.ndjson',
      'manifest.json',
      'observed.meta.json',
      'observed.ndjson',
      'oracle-loss.json',
      'oracle-sysmon.ndjson',
      'steps.json',
    ]);
    // Every file that WAS read carries a digest. The two this model does not hold
    // are listed as absent with the reason, rather than left out of the list —
    // a provenance record that silently omits what it did not read is a shorter
    // list, not an honest one.
    const absent = written.inputs.filter((input) => input.present === false);
    expect(absent.map((input) => input.name).sort()).toEqual(['steps.json']);
    for (const input of absent) expect(input.reason).toBeTruthy();
    for (const input of written.inputs.filter((entry) => entry.present === undefined)) {
      expect(input.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('says the whole score out loud, per category and per column', () => {
    score.main([path.join(DERIVED, 'M2-unconfirmed-rows'), '--out', path.join(tmp, 's')]);
    expect(said(out)).toMatch(/truth {3}file\/creation {2}1\/3/);
    expect(said(out)).toMatch(/sensor {2}file\/creation {2}recall 1\/1/);
    expect(said(out)).toMatch(/2 catalogue row\(s\) are not ground truth/);
    expect(said(out)).toMatch(/no aggregate figure is derived from any of this/);
  });
});

describe('bench/score.js — a recorded score is evidence', () => {
  it('writes the first time and compares the second, without overwriting', () => {
    const dir = stage('M1-fully-confirmed');
    expect(score.main([dir])).toBe(0);
    expect(said(out)).toMatch(/^written .*matched\.ndjson$/m);
    const recorded = fs.readFileSync(path.join(dir, metrics.METRICS_FILENAME), 'utf8');

    out = [];
    expect(score.main([dir])).toBe(0);
    expect(said(out)).toMatch(/reproduces the recorded score byte for byte/);
    expect(fs.readFileSync(path.join(dir, metrics.METRICS_FILENAME), 'utf8')).toBe(recorded);
  });

  it('reports a difference with the first differing byte and writes nothing', () => {
    const dir = stage('M1-fully-confirmed');
    score.main([dir]);
    const file = path.join(dir, metrics.METRICS_FILENAME);
    const recorded = fs.readFileSync(file, 'utf8').replace('"schemaVersion": 1', '"schemaVersion": 9');
    fs.writeFileSync(file, recorded, 'utf8');

    out = [];
    expect(score.main([dir])).toBe(1);
    expect(said(out)).toMatch(/the rebuild DIFFERS from the recorded score/);
    expect(said(out)).toMatch(/metrics\.json: first differing byte at offset \d+/);
    expect(said(out)).toMatch(/a verification that overwrites its own target is not one/);
    // The evidence is intact: the rebuild was reported, not applied.
    expect(fs.readFileSync(file, 'utf8')).toBe(recorded);
  });
});

describe('bench/score.js — what it refuses, with nothing written', () => {
  /**
   * @param {string} dir
   * @param {RegExp} reason
   * @returns {void}
   */
  const refuses = (dir, reason) => {
    expect(score.main([dir])).toBe(1);
    expect(said(out)).toMatch(reason);
    expect(said(out)).toMatch(/nothing was written/);
    expect(fs.existsSync(path.join(dir, metrics.METRICS_FILENAME))).toBe(false);
    expect(fs.existsSync(path.join(dir, metrics.MATCHED_FILENAME))).toBe(false);
  };

  it('refuses a directory missing one of the files a score is taken over', () => {
    const dir = stage('M1-fully-confirmed');
    fs.rmSync(path.join(dir, 'oracle-loss.json'));
    refuses(dir, /oracle-loss\.json is missing — it is the oracle's own collection and loss/);
  });

  it('refuses an NDJSON line that does not parse, by file and line number', () => {
    const dir = stage('M1-fully-confirmed');
    const file = path.join(dir, 'expected.ndjson');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines[2] = '{ this is not json';
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    refuses(dir, /expected\.ndjson line 3 does not parse/);
  });

  it('refuses a directory whose records disagree about which run they describe', () => {
    const dir = stage('M1-fully-confirmed');
    patch(dir, 'oracle-loss.json', (loss) => ({ ...loss, runId: 'SOMEONE-ELSES-RUN' }));
    refuses(dir, /disagree about "runId".*assembled out of two runs/s);
  });

  it('refuses an arm whose definition holds no oracle column', () => {
    const dir = stage('M1-fully-confirmed');
    patch(dir, 'manifest.json', (manifest) => ({ ...manifest, arm: 'C' }));
    refuses(dir, /arm "C" has no oracle column in its definition/);
    expect(said(out)).toMatch(/the sensor marking its own work/);
  });

  it('refuses an accounting that counts records no file holds', () => {
    const dir = stage('M1-fully-confirmed');
    fs.rmSync(path.join(dir, 'oracle-sysmon.ndjson'));
    refuses(dir, /counts 5 normalized oracle record\(s\) and .*oracle-sysmon\.ndjson does not exist/);
  });

  it('refuses a capture record that carries no scan interval at all', () => {
    const dir = stage('M1-fully-confirmed');
    patch(dir, 'observed.meta.json', (meta) => ({
      ...meta,
      sensor: { ticksWhileProcessAlive: meta.sensor.ticksWhileProcessAlive },
    }));
    refuses(dir, /carries no sensor\.scanInterval.*refused rather than scored against a window/s);
  });

  it('refuses a capture record that carries no tick count', () => {
    const dir = stage('M1-fully-confirmed');
    patch(dir, 'observed.meta.json', (meta) => ({
      ...meta,
      sensor: { scanInterval: meta.sensor.scanInterval },
    }));
    refuses(dir, /carries no sensor\.ticksWhileProcessAlive/);
  });

  it('exits 2 and runs nothing when the invocation itself is wrong', () => {
    expect(score.main([])).toBe(2);
    expect(said(out)).toMatch(/no run directory was given/);
    out = [];
    expect(score.main([path.join(DERIVED, 'M1-fully-confirmed'), '--out'])).toBe(2);
    out = [];
    expect(score.main([path.join(DERIVED, 'M1-fully-confirmed'), '--wat'])).toBe(2);
    expect(said(out)).toMatch(/unknown flag --wat/);
  });
});

describe('bench/score.js — the absences it writes rather than refuses', () => {
  it('writes the score and exits 1 when the oracle established no ground truth', () => {
    const dir = stage('M1-fully-confirmed');
    fs.rmSync(path.join(dir, 'oracle-sysmon.ndjson'));
    patch(dir, 'oracle-loss.json', (loss) => ({
      ...loss,
      collection: { ...loss.collection, ran: false, unavailable: 'no Sysmon service was found' },
      records: { ...loss.records, read: 0, normalized: 0 },
    }));

    expect(score.main([dir])).toBe(1);
    const written = JSON.parse(fs.readFileSync(path.join(dir, metrics.METRICS_FILENAME), 'utf8'));
    expect(written.oracle.collected).toBe(false);
    expect(written.oracle.records).toBe(0);
    // Every category unmeasurable, every figure null — and not one zero.
    for (const category of Object.keys(written.oracle.coverage)) {
      expect(written.oracle.coverage[category].measurable).toBe(false);
      expect(written.oracle.coverage[category].reasonCode).toBe(
        metrics.UNCONFIRMED_REASON.ORACLE_NOT_COLLECTED,
      );
      expect(written.groundTruth[category].confirmed).toBeNull();
      expect(written.sensor[category].recallValue).toBeNull();
    }
    expect(said(out)).toMatch(/the oracle established no ground truth for this run/);
    // The absent column is named in the provenance rather than left out of it.
    const absent = written.inputs.find((input) => input.name === 'oracle-sysmon.ndjson');
    expect(absent.present).toBe(false);
    expect(absent.reason).toMatch(/an empty file would be indistinguishable/);
  });

  it('writes the score and exits 1 when the join window could not be derived', () => {
    const dir = stage('M1-fully-confirmed');
    patch(dir, 'observed.meta.json', (meta) => ({
      ...meta,
      sensor: {
        ...meta.sensor,
        scanInterval: { value: null, source: 'none', unavailable: 'no settings.json was written' },
      },
    }));

    expect(score.main([dir])).toBe(1);
    const written = JSON.parse(fs.readFileSync(path.join(dir, metrics.METRICS_FILENAME), 'utf8'));
    expect(written.sensor.scored).toBe(false);
    expect(written.sensor.window.maxLatencyMs).toBeNull();
    for (const category of Object.keys(written.groundTruth)) {
      // The confirmation column does not depend on the join window at all, so it
      // is complete even here — and the sensor column is the only casualty.
      expect(written.groundTruth[category].confirmationRateValue).toBe(1);
      expect(written.sensor[category].recallValue).toBeNull();
      expect(written.sensor[category].recallUnavailable).toMatch(/never defaulted/);
    }
  });

  it('scores an arm-B directory as a confirmation column with no sensor block', () => {
    const dir = stage('M1-fully-confirmed', 'armB');
    fs.rmSync(path.join(dir, 'observed.ndjson'));
    fs.rmSync(path.join(dir, 'observed.meta.json'));
    patch(dir, 'manifest.json', (manifest) => ({ ...manifest, arm: 'B' }));
    patch(dir, 'oracle-loss.json', (loss) => ({ ...loss, arm: 'B' }));

    expect(score.main([dir])).toBe(0);
    const written = JSON.parse(fs.readFileSync(path.join(dir, metrics.METRICS_FILENAME), 'utf8'));
    expect(written.arm).toBe('B');
    expect(written.sensor.scored).toBe(false);
    expect(written.sensor.unavailable).toMatch(/arm B runs no sensor/);
    // The catalogue is still fully confirmed: that is what arm B is for.
    expect(written.groundTruth['file/creation'].confirmationRate).toBe('2/2');
    for (const row of fs
      .readFileSync(path.join(dir, metrics.MATCHED_FILENAME), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))) {
      expect(row.oracle.verdict).toBe('confirmed');
      expect(row.sensor.detectionCategory).toBeNull();
      expect(row.sensor.unavailable).toMatch(/arm B runs no sensor/);
    }
  });
});

describe('bench/score.js — the measurement column imports nothing from src/', () => {
  it('resolves no src/ module anywhere in the entrypoint’s own graph', () => {
    const graph = new Set();
    const visit = (file) => {
      if (graph.has(file)) return;
      graph.add(file);
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/require\('(\.[^']+)'\)/g)) {
        visit(require.resolve(path.resolve(path.dirname(file), match[1])));
      }
    };
    visit(path.join(REPO, 'bench', 'score.js'));
    expect(graph.size).toBeGreaterThan(1);
    expect([...graph].some((file) => file.includes(`${path.sep}src${path.sep}`))).toBe(false);
  });
});

describe('bench/score.js — steps.json, and the expectation nothing ever executed', () => {
  /**
   * Score one model and read the block back.
   * @param {string} id
   * @returns {Object}
   */
  function scenarioSteps(id) {
    const target = path.join(tmp, `steps-${id}`);
    expect(score.main([path.join(DERIVED, id), '--out', target])).toBe(0);
    return JSON.parse(fs.readFileSync(path.join(target, metrics.METRICS_FILENAME), 'utf8'));
  }

  it('counts what each declared step did, instead of reporting the question unanswerable', () => {
    const written = scenarioSteps('M4-step-failed-to-execute');
    expect(written.scenarioSteps.value).toEqual({ declared: 4, ok: 2, failed: 1, skipped: 1 });
    expect(written.scenarioSteps.source).toBe(metrics.STEPS_FILENAME);
    expect(written.scenarioSteps.unavailable).toBeUndefined();
  });

  it('names the expectations no catalogue row can ever account for', () => {
    const written = scenarioSteps('M4-step-failed-to-execute');
    // Three steps claimed an expectation and one produced a row. Without this
    // file, E2 and E3 are indistinguishable from expectations a sensor missed.
    expect(written.scenarioSteps.expectations).toEqual({
      claimed: 3,
      emitted: 1,
      notExecuted: 2,
    });
    expect(written.scenarioSteps.notExecuted.map((step) => [step.expect, step.status])).toEqual([
      ['E2', 'failed'],
      ['E3', 'skipped'],
    ]);
    expect(written.scenarioSteps.notExecuted[0].error).toMatch(/ENOENT/);
    expect(written.scenarioSteps.meaning).toMatch(
      /neither a sensor miss nor an unconfirmed catalogue row/,
    );
  });

  it('leaves those expectations out of BOTH columns, in every category', () => {
    const written = scenarioSteps('M4-step-failed-to-execute');
    // The catalogue holds one row where the scenario declared three expectations.
    // The two that never ran are not unconfirmed rows and not sensor misses:
    // their categories are simply empty, and read 0/0 with no number.
    expect(written.groundTruth['file/creation'].confirmationRate).toBe('1/1');
    for (const category of ['process/start', 'file/deletion']) {
      expect(written.groundTruth[category].catalogued).toBe(0);
      expect(written.groundTruth[category].unconfirmedRows).toEqual([]);
      expect(written.sensor[category].recall).toBe('0/0');
      expect(written.sensor[category].recallValue).toBeNull();
      expect(written.sensor[category].notDetected).toBe(0);
    }
  });

  it('records the artefact as an honest absence when a run directory holds none', () => {
    const written = scenarioSteps('M1-fully-confirmed');
    expect(written.scenarioSteps.value).toBeNull();
    expect(written.scenarioSteps.unavailable).toMatch(/holds no readable steps\.json/);
    expect(written.scenarioSteps.unavailable).toMatch(
      /rather than inferred from a catalogue that is shorter than its scenario/,
    );
    const absent = written.inputs.find((input) => input.name === metrics.STEPS_FILENAME);
    expect(absent.present).toBe(false);
  });

  it('digests it into the provenance when it is there', () => {
    const written = scenarioSteps('M4-step-failed-to-execute');
    const input = written.inputs.find((entry) => entry.name === metrics.STEPS_FILENAME);
    expect(input.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(input.present).toBeUndefined();
  });

  it('holds it to the same run identity as every other record', () => {
    const dir = stage('M4-step-failed-to-execute');
    patch(dir, metrics.STEPS_FILENAME, (steps) => ({ ...steps, runId: 'SOMEONE-ELSES-RUN' }));
    expect(score.main([dir])).toBe(1);
    expect(said(out)).toMatch(/disagree about "runId"/);
    expect(said(out)).toMatch(/nothing was written/);
    expect(fs.existsSync(path.join(dir, metrics.METRICS_FILENAME))).toBe(false);
  });

  it('refuses a steps.json that is there and does not parse', () => {
    const dir = stage('M4-step-failed-to-execute', 'broken-steps');
    fs.writeFileSync(path.join(dir, metrics.STEPS_FILENAME), '{ not json', 'utf8');
    expect(score.main([dir])).toBe(1);
    expect(said(out)).toMatch(/steps\.json is not valid JSON/);
    expect(fs.existsSync(path.join(dir, metrics.METRICS_FILENAME))).toBe(false);
  });
});
