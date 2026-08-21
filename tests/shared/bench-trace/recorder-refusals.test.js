/**
 * @file tests/shared/bench-trace/recorder-refusals.test.js
 * @description What the recorder REFUSES, by name — the property all of it serves:
 *   a recorder must not be able to produce a trace the reader refuses, and it must
 *   not quietly drop what the format cannot hold.
 *
 *   The recording directories here are SYNTHETIC, laid down by hand, for the same
 *   reason `trace-reader-refusals.test.js` builds synthetic headers: a refusal suite
 *   that recorded through the real graph would pass for a different reason on every
 *   machine. The one positive case (a valid synthetic recording derives to a trace
 *   the reader accepts) closes the loop against `_make-trace`'s synthetic
 *   environment; the real-tree positive lives in `recorder-roundtrip.test.js`.
 *
 *   `setUpRecording`'s clock refusal is safe to check in-process precisely because
 *   it fires BEFORE any product module is loaded — the same ordering `wiring.setUp`
 *   documents. Everything needing a wired product stays in the spawned round-trip
 *   suite.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterAll } from 'vitest';

import recorder from '../../../bench/trace/recorder.js';
import reader from '../../../bench/trace/reader.js';
import schema from '../../../bench/trace/schema.js';
import { CLOCK_EPOCH_MS, makeAgent, makeAmbient, makeEnv } from './_make-trace.js';

/** @type {string[]} Every directory a test created, removed at the end. */
const scratchDirs = [];

/** @returns {string} A fresh scratch directory. */
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-recorder-refusals-'));
  scratchDirs.push(dir);
  return dir;
}

/** @returns {Object[]} A small, valid observation list in the raw file's shape. */
function makeObservations() {
  return [
    {
      kind: 'population.set',
      epochMs: CLOCK_EPOCH_MS,
      input: { agents: [makeAgent()] },
    },
    {
      kind: 'fs.event',
      epochMs: CLOCK_EPOCH_MS + 10,
      input: { action: 'created', path: 'X:\\dev\\project\\AEGIS\\.env' },
      ambient: makeAmbient(),
    },
  ];
}

/**
 * Lay down one synthetic recording directory.
 * @param {Object} [opts]
 * @param {Object|null} [opts.meta] - The meta object; `null` omits the file.
 * @param {Object|null} [opts.done] - The done object; `null` omits the file.
 * @param {Object[]|null} [opts.observations] - Raw observations; `null` omits the file.
 * @param {string} [opts.observationsText] - Raw bytes, overriding `observations`.
 * @returns {string} The recording directory.
 */
function makeRecordingDir(opts = {}) {
  const dir = scratch();
  const meta =
    opts.meta !== undefined
      ? opts.meta
      : {
          recordingSchemaVersion: recorder.RECORDING_SCHEMA_VERSION,
          clockEpochMs: CLOCK_EPOCH_MS,
          settings: {},
          env: makeEnv(),
        };
  if (meta !== null) {
    fs.writeFileSync(path.join(dir, recorder.META_FILENAME), JSON.stringify(meta, null, 2));
  }
  const done =
    opts.done !== undefined
      ? opts.done
      : { auditFiles: ['aegis-audit-2026-08-21.json'], unrecordable: [] };
  if (done !== null) {
    fs.writeFileSync(path.join(dir, recorder.DONE_FILENAME), JSON.stringify(done, null, 2));
  }
  const observations = opts.observations !== undefined ? opts.observations : makeObservations();
  if (opts.observationsText !== undefined) {
    fs.writeFileSync(path.join(dir, recorder.OBSERVATIONS_FILENAME), opts.observationsText);
  } else if (observations !== null) {
    fs.writeFileSync(
      path.join(dir, recorder.OBSERVATIONS_FILENAME),
      observations.map((o) => JSON.stringify(o)).join('\n') + '\n',
    );
  }
  return dir;
}

/**
 * Run `deriveTrace` and hand back what it threw.
 * @param {string} runDir
 * @returns {Error|null}
 */
function deriveError(runDir) {
  try {
    recorder.deriveTrace({ runDir, traceDir: path.join(scratch(), 'trace'), id: 'T9-refusals' });
    return null;
  } catch (err) {
    return err;
  }
}

afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('setUpRecording — the clock guard', () => {
  it('refuses without a virtual clock, before any product module is loaded', () => {
    // This worker has no preload, which is exactly the point: the guard fires first.
    let err = null;
    try {
      recorder.setUpRecording({ runDir: path.join(scratch(), 'rec') });
    } catch (e) {
      err = e;
    }
    expect(err && err.reason).toBe(schema.REFUSAL.RECORD_MALFORMED);
    expect(err.message).toContain('no virtual clock is installed');
  });
});

describe('deriveTrace — the positive case the refusals give meaning to', () => {
  it('derives a valid recording to a trace the READER accepts', () => {
    const runDir = makeRecordingDir();
    const traceDir = path.join(scratch(), 'trace');
    const result = recorder.deriveTrace({ runDir, traceDir, id: 'T9-valid' });
    expect(result.records).toBe(2);

    // The loop this suite exists to close: reader.readTrace, not a hand check.
    const trace = reader.readTrace(traceDir, { env: makeEnv() });
    expect(trace.header.id).toBe('T9-valid');
    expect(trace.header.clock.epochMs).toBe(CLOCK_EPOCH_MS);
    expect(trace.records.map((r) => r.bench.kind)).toEqual(['population.set', 'fs.event']);
  });
});

describe('deriveTrace — refusals, by name', () => {
  it('refuses a recording with no meta file', () => {
    const err = deriveError(makeRecordingDir({ meta: null }));
    expect(err.reason).toBe(schema.REFUSAL.FILE_UNREADABLE);
    expect(err.message).toContain(recorder.META_FILENAME);
  });

  it('refuses a meta file of another version', () => {
    const err = deriveError(
      makeRecordingDir({
        meta: { recordingSchemaVersion: 99, clockEpochMs: CLOCK_EPOCH_MS, env: makeEnv() },
      }),
    );
    expect(err.reason).toBe(schema.REFUSAL.SCHEMA_VERSION);
  });

  it('refuses a meta file with no recorded environment, rather than re-pinning the tree', () => {
    const err = deriveError(
      makeRecordingDir({
        meta: {
          recordingSchemaVersion: recorder.RECORDING_SCHEMA_VERSION,
          clockEpochMs: CLOCK_EPOCH_MS,
          settings: {},
        },
      }),
    );
    expect(err.reason).toBe(schema.REFUSAL.RECORD_MALFORMED);
    expect(err.message).toContain('environment observed at recording time');
  });

  it('refuses a meta file with no clock epoch', () => {
    const err = deriveError(
      makeRecordingDir({
        meta: {
          recordingSchemaVersion: recorder.RECORDING_SCHEMA_VERSION,
          settings: {},
          env: makeEnv(),
        },
      }),
    );
    expect(err.reason).toBe(schema.REFUSAL.RECORD_MALFORMED);
    expect(err.message).toContain('clockEpochMs');
  });

  it('refuses a recording that never finished — the done file is absent', () => {
    const err = deriveError(makeRecordingDir({ done: null }));
    expect(err.reason).toBe(schema.REFUSAL.FILE_UNREADABLE);
    expect(err.message).toContain('never finished');
  });

  it('refuses a recording holding observations the format could not express', () => {
    const err = deriveError(
      makeRecordingDir({
        done: {
          auditFiles: ['aegis-audit-2026-08-21.json'],
          unrecordable: [{ provider: 'getFileHandles', why: 'threw for pid 4812' }],
        },
      }),
    );
    expect(err.reason).toBe(schema.REFUSAL.RECORD_MALFORMED);
    expect(err.message).toContain('getFileHandles');
    expect(err.message).toContain('cannot express');
  });

  it('refuses an empty observations file, by the reader’s own name for it', () => {
    const err = deriveError(makeRecordingDir({ observationsText: '' }));
    expect(err.reason).toBe(schema.REFUSAL.EMPTY_TRACE);
  });

  it('refuses a missing observations file', () => {
    const err = deriveError(makeRecordingDir({ observations: null }));
    expect(err.reason).toBe(schema.REFUSAL.FILE_UNREADABLE);
  });

  it('refuses an observation line that does not parse', () => {
    const err = deriveError(makeRecordingDir({ observationsText: '{"kind": "fs.eve\n' }));
    expect(err.reason).toBe(schema.REFUSAL.RECORD_MALFORMED);
    expect(err.message).toContain('line 0');
  });

  it('refuses an observation of a kind outside the closed list', () => {
    const err = deriveError(
      makeRecordingDir({
        observations: [{ kind: 'fs.renamed', epochMs: CLOCK_EPOCH_MS, input: {} }],
      }),
    );
    expect(err.reason).toBe(schema.REFUSAL.UNKNOWN_KIND);
  });

  it('refuses an observation whose kind demands an ambient scope it does not carry', () => {
    const observations = makeObservations();
    delete observations[1].ambient;
    const err = deriveError(makeRecordingDir({ observations }));
    expect(err.reason).toBe(schema.REFUSAL.RECORD_MALFORMED);
    expect(err.message).toContain('ambient');
  });
});

describe('the Recording validates before it appends', () => {
  /**
   * A Recording over stubs — enough shape for `_append`, nothing real behind it.
   * @param {string} runDir
   * @returns {Object}
   */
  function bareRecording(runDir) {
    return new recorder.Recording({
      runDir,
      observationsPath: path.join(runDir, recorder.OBSERVATIONS_FILENAME),
      tap: new recorder.Tap({}),
      wired: { ambient: { populationReliable: true, isOtherPanelExpanded: false } },
      calls: {},
      clock: {},
    });
  }

  it('refuses a malformed observation and leaves NO line behind', () => {
    const runDir = scratch();
    const recording = bareRecording(runDir);
    let err = null;
    try {
      recording._append('fs.event', { action: 'exploded', path: 'X:\\x' });
    } catch (e) {
      err = e;
    }
    expect(err && err.reason).toBe(schema.REFUSAL.RECORD_MALFORMED);
    expect(fs.existsSync(path.join(runDir, recorder.OBSERVATIONS_FILENAME))).toBe(false);
  });

  it('appends a valid observation with the ambient snapshot its kind demands', () => {
    const runDir = scratch();
    const recording = bareRecording(runDir);
    recording._append('fs.event', { action: 'created', path: 'X:\\x\\.env' });
    const lines = fs
      .readFileSync(path.join(runDir, recorder.OBSERVATIONS_FILENAME), 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(1);
    const observation = JSON.parse(lines[0]);
    expect(observation.kind).toBe('fs.event');
    expect(observation.ambient).toEqual({ populationReliable: true, isOtherPanelExpanded: false });
  });

  it('refuses an observation after finish() sealed the recording', () => {
    const runDir = scratch();
    const recording = bareRecording(runDir);
    recording._finished = true;
    let err = null;
    try {
      recording._append('clock.advance', { toEpochMs: CLOCK_EPOCH_MS + 1 });
    } catch (e) {
      err = e;
    }
    expect(err && err.reason).toBe(schema.REFUSAL.RECORD_MALFORMED);
    expect(err.message).toContain('finished');
  });
});

describe('the Tap — record-and-pass-through, bytes unchanged', () => {
  it('hands back the provider’s OWN answer and buffers a copy of it', async () => {
    const answer = [path.join('X:', 'p', 'id_rsa')];
    const tap = new recorder.Tap({ getFileHandles: async () => answer });
    tap.begin('handles');
    const returned = await tap.wrapped.getFileHandles(4812);
    expect(returned).toBe(answer);
    const collected = tap.end();
    expect(collected.byPid['4812']).toEqual(answer);
    expect(collected.byPid['4812']).not.toBe(answer);
    expect(tap.unrecordable).toEqual([]);
  });

  it('records a DNS throw as null — the format’s word for "the lookup threw"', async () => {
    const tap = new recorder.Tap({
      dnsReverse: async () => {
        throw new Error('scripted-failure');
      },
    });
    tap.begin('net');
    await expect(tap.wrapped.dnsReverse('203.0.113.10')).rejects.toThrow('scripted-failure');
    expect(tap.end().dns['203.0.113.10']).toEqual({ reverse: null, forward: null });
    expect(tap.unrecordable).toEqual([]);
  });

  it('attributes a forward answer by the replay’s own rule — first recorded reverse', async () => {
    const tap = new recorder.Tap({
      dnsReverse: async () => ['api.example.com'],
      dnsResolve: async () => ['203.0.113.99'],
    });
    tap.begin('net');
    await tap.wrapped.dnsReverse('203.0.113.10');
    await tap.wrapped.dnsResolve('api.example.com');
    expect(tap.end().dns['203.0.113.10']).toEqual({
      reverse: ['api.example.com'],
      forward: ['203.0.113.99'],
    });
    expect(tap.unrecordable).toEqual([]);
  });

  it('marks a REAL forward answer with no reverse to hang it on as unrecordable', async () => {
    const tap = new recorder.Tap({ dnsResolve: async () => ['203.0.113.99'] });
    tap.begin('net');
    await tap.wrapped.dnsResolve('orphan.example.com');
    expect(tap.unrecordable.length).toBe(1);
    expect(tap.unrecordable[0].provider).toBe('dnsResolve');
  });

  it('marks a provider THROW as unrecordable — the format records answers only', async () => {
    const tap = new recorder.Tap({
      getFileHandles: async () => {
        throw new Error('handle scan failed');
      },
    });
    tap.begin('handles');
    await expect(tap.wrapped.getFileHandles(4812)).rejects.toThrow('handle scan failed');
    expect(tap.unrecordable.length).toBe(1);
    expect(tap.unrecordable[0].provider).toBe('getFileHandles');
  });

  it('marks an answer arriving with no tick open as unrecordable', async () => {
    const tap = new recorder.Tap({ getFileHandles: async () => [] });
    await tap.wrapped.getFileHandles(4812);
    expect(tap.unrecordable.length).toBe(1);
    expect(tap.unrecordable[0].why).toContain('outside a handles tick');
  });
});
