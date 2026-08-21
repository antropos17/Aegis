/**
 * @file tests/shared/bench-trace/recorder-roundtrip.test.js
 * @description The recorder's whole claim, checked end to end: a recorded session
 *   derives to a trace that replays to the very bytes the recording run wrote, and
 *   the tap that recorded it changed nothing about what the sensor decided.
 *
 *   THREE CHILD PROCESSES, ONE SESSION. `_record-session.js` defines one scripted
 *   session and runs it in two postures — `tap` (through the recorder) and `no-tap`
 *   (the same graph, the same scripted providers, no tap anywhere) — and the replay
 *   runs through `bench/trace/bench-replay.js`, the same command `npm run
 *   bench:replay` executes. Spawning rather than calling is not a style choice: the
 *   clock has to be installed before any product module is compiled, and the
 *   one-graph-per-process rule then holds naturally (the reasons
 *   `harness-replay.test.js` already states).
 *
 *   EVERY ASSERTION HERE IS AN EQUALITY OF BYTES, not of evidence codes, so the suite
 *   is portable to whatever platform runs it — the session's synthetic paths follow
 *   the platform, and what is compared is one run's output against another's.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import clockEnv from '../../../bench/trace/clock-env.js';
import reader from '../../../bench/trace/reader.js';
import recorder from '../../../bench/trace/recorder.js';
import replayTrace from '../../../bench/trace/replay-trace.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const PRELOAD = path.join(REPO_ROOT, 'bench', 'trace', 'preload.js');
const DRIVER = path.join(HERE, '_record-session.js');
const WRAPPER = path.join(REPO_ROOT, 'bench', 'trace', 'bench-replay.js');

/** @type {number} 2026-08-21T09:13:52.000Z — the instant `harness-replay` also pins. */
const EPOCH_MS = 1_787_303_632_000;

/** @type {string} Scratch root for this suite. */
let scratch;
/** @type {{auditFile: string, observationsPath: string, traceDir: string}} */
let tap;

/**
 * Run the scripted session in a child, in one posture.
 * @param {string} mode - `tap` | `no-tap`.
 * @param {string} runDir
 * @param {string} [traceDir]
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function runSession(mode, runDir, traceDir) {
  const args = ['--require', PRELOAD, DRIVER, mode, runDir];
  if (traceDir) args.push(traceDir);
  // The zone is deliberately NOT set: the recording observes the machine's own zone
  // into its header, and the replay wrapper hands that observation back — the same
  // round-trip a real recording relies on.
  const env = { ...process.env, [clockEnv.EPOCH_ENV]: String(EPOCH_MS) };
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: REPO_ROOT, env });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-recorder-test-'));
  const result = runSession('tap', path.join(scratch, 'rec-tap'), path.join(scratch, 'trace'));
  expect(result.status, result.stderr).toBe(0);
  tap = JSON.parse(result.stdout);
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('recording — what the run leaves behind', () => {
  it('appends the raw observations during the run, one line per observation', () => {
    const lines = fs
      .readFileSync(tap.observationsPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    // The session's own shape: population, two fs events, a clock advance, a handles
    // tick, an rm tick (win32 only — the hot Restart Manager source exists nowhere
    // else, and the product refuses to tick an UNSUPPORTED sensor), a second
    // advance, a net tick.
    const kinds = lines.map((l) => JSON.parse(l).kind);
    expect(kinds).toEqual(
      [
        'population.set',
        'fs.event',
        'fs.event',
        'clock.advance',
        'handles.tick',
        process.platform === 'win32' ? 'rm.hot.tick' : null,
        'clock.advance',
        'net.tick',
      ].filter(Boolean),
    );
  });

  it('writes the product’s own audit records — the recording’s verdict', () => {
    const text = fs.readFileSync(tap.auditFile, 'utf8');
    const records = text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
    expect(records.length).toBeGreaterThan(0);
    records.forEach((record, i) => {
      expect(record.schemaVersion).toBe(1);
      expect(record.seq).toBe(i);
    });
  });
});

describe('recording — the derived trace', () => {
  it('is one the reader ACCEPTS: same header shape, same chain, same kinds', () => {
    // "A recorder must not be able to produce a trace the reader refuses" — checked
    // against the real tree, which is exactly what a replay of this trace will do.
    const trace = reader.readTrace(tap.traceDir);
    expect(trace.header.id).toBe('T1-recorded-session');
    expect(trace.header.clock.epochMs).toBe(EPOCH_MS);
    expect(trace.header.provenance.source).toBe('bench/trace/recorder.js');
    expect(trace.records.length).toBe(process.platform === 'win32' ? 8 : 7);
  });

  it('derives offline from the raw file, refusing a second write of the same trace', () => {
    let err = null;
    try {
      recorder.deriveTrace({
        runDir: path.dirname(tap.observationsPath),
        traceDir: tap.traceDir,
        id: 'T1-recorded-session',
      });
    } catch (e) {
      err = e;
    }
    expect(err && err.reason).toBe('file-unreadable');
    expect(err.message).toContain('never written twice');
  });
});

describe('round-trip — record, derive, replay', () => {
  it('replays through the bench:replay wrapper to the EXACT bytes the recording wrote', () => {
    const outDir = path.join(scratch, 'replay-out');
    // The same command `npm run bench:replay -- <trace> --out <dir>` runs; the
    // wrapper reads the clock and the zone out of the trace's own header.
    const result = spawnSync(process.execPath, [WRAPPER, tap.traceDir, '--out', outDir], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env },
    });
    expect(result.status, result.stderr).toBe(0);

    const recorded = fs.readFileSync(tap.auditFile);
    const replayed = fs.readFileSync(path.join(outDir, replayTrace.VERDICT_FILENAME));
    expect(recorded.length).toBeGreaterThan(0);
    expect(replayed.equals(recorded)).toBe(true);
  });
});

describe('the tap changes nothing', () => {
  it('tap-on and tap-off verdicts are byte-identical on the same scripted inputs', () => {
    const result = runSession('no-tap', path.join(scratch, 'rec-no-tap'));
    expect(result.status, result.stderr).toBe(0);
    const noTap = JSON.parse(result.stdout);

    const withTap = fs.readFileSync(tap.auditFile);
    const withoutTap = fs.readFileSync(noTap.auditFile);
    expect(withTap.length).toBeGreaterThan(0);
    expect(withoutTap.equals(withTap)).toBe(true);
  });
});
