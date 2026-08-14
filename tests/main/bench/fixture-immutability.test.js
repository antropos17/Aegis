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
 * Taken from the files as committed in PR #220, which are themselves byte-equal
 * to the untracked originals the two runs left in `bench/runs/`.
 * @type {Readonly<Object<string, Object<string, [string, number]>>>}
 */
const RECORDED = Object.freeze({
  '2026-08-13T17-11-03Z-S1-agent-lifecycle-A': {
    'expected.ndjson': ['218a147a1b5dda6c74e2b71719454f1c8f4de4d630416aea7f6b01b036550d98', 2121],
    'manifest.json': ['9c52b49193129c4130da9755686f06c42ae6f669f72ee69898ca10d1f614f5b9', 2167],
    'observed.meta.json': [
      'ddee0b3cfe65f6c6c37b3ba219f9356b6329b8e93cc3935291bdecae83a2d04d',
      1948,
    ],
    'observed.ndjson': ['54a349b0d477ee309d74559e5429a7e78b533501c58a08e98d0dff0195e2fc5f', 2506],
  },
  '2026-08-13T19-26-29Z-S1-agent-lifecycle-A': {
    'expected.ndjson': ['9cf015de3c4afbb59d4f34763ba92fbed1d95a88fb290ccceda27a55b4d5e446', 2119],
    'manifest.json': ['257206674bdecac1a786f174362e08898c5f3f866fdf76575840cb3d2f90ae5b', 2155],
    'observed.meta.json': [
      '436b8fc8a50b71dfe03929d279feb7eba92ac22794a59daac0d964e7668c439c',
      2576,
    ],
    'observed.ndjson': ['8df799f88f2968ed90d85846be3043a11f8b9c92211670592f2d64a3ac7dc242', 2003],
    'run-report.json': ['fa8f4fe32260b93b68a117a112f05ed589a56014488c92546fd21dac1703b11a', 5251],
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
