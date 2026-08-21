/**
 * @file tests/main/bench/fixture-immutability.test.js
 * @description The nine files under `tests/fixtures/bench/runs/` are two real
 *   arm-A runs, and they are recordings: the observation is never rewritten by
 *   the interpretation. This file is the gate on that sentence.
 *
 *   The hashes below are committed constants, not a snapshot taken at startup, and
 *   that is the stronger check of the two. A before/after diff only catches a test
 *   that edits a fixture while the suite is running; committed digests catch that
 *   AND a regeneration committed by hand, a formatter that reached the tree, a
 *   line-ending conversion on a Windows checkout, and a replay that wrote a new
 *   file into a recording. The digests are checked twice — before this file's
 *   tests and after them — which is what a same-file mutation would trip.
 *   Cross-file ordering inside one vitest run is not guaranteed, so the guarantee
 *   this file gives is against the committed bytes rather than against a moment.
 *
 *   Two recordings, four and five files: the earlier run predates
 *   `run-report.json`. Their file SETS are pinned too, so an artefact appearing
 *   inside a recording is a failure here rather than a discovery three months
 *   later.
 *
 *   Derived artefacts are deliberately not covered. A current-renderer golden
 *   under `tests/fixtures/bench/goldens/` is expected to move whenever the
 *   renderer renders a string differently; that is what makes it a golden and a
 *   recording not one.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const RUNS = path.join(REPO, 'tests', 'fixtures', 'bench', 'runs');

/**
 * Every recorded byte, by run directory and file name: `[sha256, length]`.
 *
 * Taken from the files as committed after the machine-identity redaction.
 * Paths use `X:\dev\project\AEGIS` and `C:\Users\user`; host is platform only.
 * @type {Readonly<Object<string, Object<string, [string, number]>>>}
 */
const RECORDED = Object.freeze({
  '2026-08-13T17-11-03Z-S1-agent-lifecycle-A': {
    'expected.ndjson': ['4aed1781f655c275d3e0f90be0c23fab1b058851d79ff740eb70d538ad6b843e', 2109],
    'manifest.json': ['31d0824daa325e35fa688f410d5a5b438509862d2297756c6d96003d99d2ec1d', 1273],
    'observed.meta.json': [
      '4d130526ceba9a9cd76bce9a1095650629ec362aea96dca06a9ce80befdea67e',
      1944,
    ],
    'observed.ndjson': ['a9ef62cf95cd8548f374e1c7fe5ffc62e8791182723a25128ce84b97450d2326', 2494],
  },
  '2026-08-13T19-26-29Z-S1-agent-lifecycle-A': {
    'expected.ndjson': ['a744aff0f4318e5dc5a3c2a2442a2fca573ca3fbf89793e7b566e6b5ae301058', 2107],
    'manifest.json': ['067f6039e0b398eacdcb77780ce61ea72005e256176343c167809604d958c225', 1261],
    'observed.meta.json': [
      '0c55de2254f25b9ea280e6d003939312f48a305f9ccab62f3ae9db6482007300',
      2571,
    ],
    'observed.ndjson': ['c57d1698c3df34a3bf70e5568616da29116d7a1937ea49e6d8d6710d212c522c', 1995],
    'run-report.json': ['a1a1e8a7746c66eb776511a289f17137b44ff63a1b22d8d80589b436fdfa383d', 5246],
  },
});

/**
 * Digest one recorded file as bytes, never as decoded text.
 * @param {string} file - Absolute path.
 * @returns {{sha256: string, length: number}}
 */
function digest(file) {
  const bytes = fs.readFileSync(file);
  return { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), length: bytes.length };
}

/**
 * Hold every recording up against the committed digests.
 * @param {string} when - Named in the failure, so a mutation says when it happened.
 * @returns {void}
 */
function assertRecordingsIntact(when) {
  for (const [runId, files] of Object.entries(RECORDED)) {
    const dir = path.join(RUNS, runId);
    const actual = fs.readdirSync(dir).sort();
    if (actual.join('|') !== Object.keys(files).sort().join('|')) {
      throw new Error(
        `${when}: ${runId} holds [${actual.join(', ')}] — a recording is the files that run ` +
          `wrote and nothing else, and this one is expected to hold ` +
          `[${Object.keys(files).sort().join(', ')}]`,
      );
    }
    for (const [name, [sha256, length]] of Object.entries(files)) {
      const got = digest(path.join(dir, name));
      if (got.sha256 !== sha256 || got.length !== length) {
        throw new Error(
          `${when}: ${runId}/${name} is ${got.length} bytes sha256 ${got.sha256}, and the ` +
            `recording is ${length} bytes sha256 ${sha256}. A recording is never regenerated: ` +
            'if this renderer now renders a report differently, that belongs in a derived ' +
            'golden under tests/fixtures/bench/goldens/, not in the run directory',
        );
      }
    }
  }
}

beforeAll(() => assertRecordingsIntact('before this file ran'));
afterAll(() => assertRecordingsIntact('after this file ran'));

describe('bench fixtures — the recordings are immutable', () => {
  it('holds nine recorded files across two runs, byte for byte as recorded', () => {
    const names = Object.values(RECORDED).flatMap((files) => Object.keys(files));
    expect(names).toHaveLength(9);
    expect(() => assertRecordingsIntact('at assertion time')).not.toThrow();
  });

  for (const [runId, files] of Object.entries(RECORDED)) {
    it(`${runId} holds exactly its recorded file set`, () => {
      expect(fs.readdirSync(path.join(RUNS, runId)).sort()).toEqual(Object.keys(files).sort());
    });

    for (const [name, [sha256, length]] of Object.entries(files)) {
      it(`${runId}/${name} is unchanged`, () => {
        expect(digest(path.join(RUNS, runId, name))).toEqual({ sha256, length });
      });
    }
  }

  it('pins the earlier run as the four-file recording it is, with no report', () => {
    const files = RECORDED['2026-08-13T17-11-03Z-S1-agent-lifecycle-A'];
    expect(Object.keys(files)).toHaveLength(4);
    expect(files['run-report.json']).toBeUndefined();
  });
});
