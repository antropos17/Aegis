/**
 * @file tests/shared/bench-trace/orchestration-drift.test.js
 * @description The drift guard for the three orchestration sites the harness has to
 *   reproduce by hand.
 *
 *   WHY THE DUPLICATION EXISTS. `handleWatcherEvent` does not write to the audit log;
 *   the path from a detection to an Event Schema v1 record is closed outside the
 *   watcher, in `main.js`'s `onFileEvent` and in `scan-loop.js`'s `doFileScan` and
 *   `doHotReadScan`. None of those three is exported, so a replay performs the same
 *   steps itself — and a copy drifts silently by default. If an original grew a step,
 *   the harness would keep replaying yesterday's wiring while every suite stayed
 *   green, and the bench's green would stop meaning anything.
 *
 *   WHAT THIS CLOSES, AND IN BOTH DIRECTIONS:
 *     1. the product's source → `harness.ORCHESTRATION`: the sequence is DERIVED from
 *        `src/main/*.js` at test time, never copied into this file;
 *     2. `harness.ORCHESTRATION` → the harness: the shipped code paths are driven with
 *        recording steps, so the declaration is proved to describe what actually runs.
 *   Either side moving alone is red. A declaration nobody checks against the code is a
 *   promise, and the point of this file is that there is no promise anywhere in it.
 *
 *   WHAT IT CANNOT DO, and it is worth saying plainly: it is one-sided. The guard
 *   lives here, so a developer editing `scan-loop.js` learns about the harness when CI
 *   goes red, not while they are typing. A comment at each product site pointing back
 *   here would close that half — it is two lines in `src/`, which this branch may not
 *   touch. The failure message names the file and the anchor to open, so the red still
 *   points at the right place.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

import harness from '../../../bench/trace/harness.js';
import schema from '../../../bench/trace/schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

/** The calls that make up the file pipeline. Anything else in a body is not drift. */
const WATCHED = ['scanAllFileHandles', 'scanHotFileHolders', 'dedupFileEvent', 'logAuditForFile'];

/**
 * Remove comments and string bodies, so a mention inside either is not read as code.
 *
 * A comment naming `dedupFileEvent` — and `scan-loop.js` has several — would otherwise
 * enter the sequence and make the guard fire on a documentation edit.
 * @param {string} src
 * @returns {string}
 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      out += '""';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * The body of the first block that opens after `anchor`, by brace matching.
 * @param {string} src - Source with comments and strings already stripped.
 * @param {string} anchor - A stable prefix of the declaration.
 * @returns {string|null} The body, or `null` when the anchor is gone.
 */
function bodyAfter(src, anchor) {
  const at = src.indexOf(anchor);
  if (at < 0) return null;
  const open = src.indexOf('{', at + anchor.length - 1);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * The watched names a body mentions, in order of appearance.
 *
 * A bare identifier counts, not only a call: `rawEvents.map(dedupFileEvent)` passes the
 * step as a reference, and a matcher that required a following `(` would miss exactly
 * the step most likely to be dropped.
 * @param {string} body
 * @returns {string[]}
 */
function callSequence(body) {
  const re = new RegExp(`\\b(${WATCHED.join('|')})\\b`, 'g');
  const found = [];
  let m;
  while ((m = re.exec(body))) found.push(m[1]);
  return found;
}

/**
 * Derive one site's sequence from the product's source.
 * @param {{file: string, anchor: string}} site
 * @returns {string[]}
 */
function sequenceFromSource(site) {
  const src = stripCommentsAndStrings(fs.readFileSync(path.join(REPO_ROOT, site.file), 'utf8'));
  const body = bodyAfter(src, site.anchor);
  expect(
    body,
    `${site.file}: the anchor ${JSON.stringify(site.anchor)} is gone. The harness reproduces this ` +
      'site by hand (harness.js ORCHESTRATION); if it was renamed or restructured, the harness ' +
      'has to follow before this guard can pass',
  ).not.toBeNull();
  return callSequence(body);
}

/** A `calls` object that records the order it is used in. */
function recorder() {
  const seen = [];
  return {
    seen,
    dedupFileEvent: (ev) => {
      seen.push('dedupFileEvent');
      return ev;
    },
    logAuditForFile: () => {
      seen.push('logAuditForFile');
    },
    scanAllFileHandles: async () => {
      seen.push('scanAllFileHandles');
      return [{ file: 'a' }];
    },
    scanHotFileHolders: async () => {
      seen.push('scanHotFileHolders');
      return [{ file: 'a' }];
    },
  };
}

/** The minimum `wired` shape `replayRecord` reads, with nothing real behind it. */
function fakeWired() {
  return {
    ambient: {
      populationReliable: true,
      isOtherPanelExpanded: false,
      agents: [],
      all: () => [],
      ai: () => [],
    },
    modules: {},
    providers: {},
    state: {},
  };
}

describe('orchestration drift — the product side', () => {
  it('derives each declared sequence from the source it was read off', () => {
    for (const [kind, site] of Object.entries(harness.ORCHESTRATION_SITES)) {
      expect(
        sequenceFromSource(site),
        `${kind} is reproduced from ${site.file} ${site.anchor} — if that site changed, ` +
          'bench/trace/harness.js must change with it',
      ).toEqual([...harness.ORCHESTRATION[kind]]);
    }
  });

  it('covers every site the harness declares, and no site it does not', () => {
    expect(Object.keys(harness.ORCHESTRATION_SITES).sort()).toEqual(
      Object.keys(harness.ORCHESTRATION).sort(),
    );
  });

  it('CAN fail: a dropped step changes the derived sequence', () => {
    // Without this the suite would prove the extractor runs, not that it inspects
    // anything — a green that means nothing is the failure this guard exists to stop.
    const real = stripCommentsAndStrings(
      fs.readFileSync(path.join(REPO_ROOT, 'src/main/scan-loop.js'), 'utf8'),
    );
    const mutated = real.replace(
      'rawEvents.map(dedupFileEvent).filter(Boolean)',
      'rawEvents.filter(Boolean)',
    );
    expect(mutated, 'the mutation anchor still exists in scan-loop.js').not.toBe(real);
    const before = callSequence(bodyAfter(real, 'async function doFileScan('));
    const after = callSequence(bodyAfter(mutated, 'async function doFileScan('));
    expect(before).toContain('dedupFileEvent');
    expect(after).not.toContain('dedupFileEvent');
  });

  it('CAN fail: a vanished anchor is reported as a vanished anchor', () => {
    expect(bodyAfter('function somethingElse() { return 1; }', 'async function doFileScan(')).toBe(
      null,
    );
  });

  it('ignores a step named only in a comment or a string', () => {
    const src = stripCommentsAndStrings(
      'function f() { /* dedupFileEvent */ const s = "logAuditForFile"; return s; }',
    );
    expect(callSequence(bodyAfter(src, 'function f('))).toEqual([]);
  });
});

describe('orchestration drift — the harness side', () => {
  it('performs, for each kind, exactly the calls it declares', async () => {
    const clock = { advanceTo: () => {} };

    const fsRec = recorder();
    const fsWired = fakeWired();
    harness.installFileEventHook(fsWired, fsRec);
    fsWired.modules.fileWatcher = {
      handleWatcherEvent: () => fsWired.state.onFileEvent({ file: 'a' }),
    };
    await harness.replayRecord(
      { bench: { kind: 'fs.event', input: { action: 'created', path: 'a' } } },
      fsWired,
      fsRec,
      clock,
    );
    expect(fsRec.seen).toEqual([...harness.ORCHESTRATION['fs.event']]);

    const poolRec = recorder();
    await harness.replayRecord(
      { bench: { kind: 'handles.tick', input: { byPid: {} } } },
      fakeWired(),
      poolRec,
      clock,
    );
    expect(poolRec.seen).toEqual([...harness.ORCHESTRATION['handles.tick']]);

    const rmRec = recorder();
    await harness.replayRecord(
      { bench: { kind: 'rm.hot.tick', input: { holders: [] } } },
      fakeWired(),
      rmRec,
      clock,
    );
    expect(rmRec.seen).toEqual([...harness.ORCHESTRATION['rm.hot.tick']]);
  });

  it('drops an event the dedup suppressed, instead of auditing it anyway', () => {
    const seen = [];
    const written = harness.pipeFileEvents([{ file: 'a' }, { file: 'b' }], {
      dedupFileEvent: (ev) => {
        seen.push('dedupFileEvent');
        return ev.file === 'a' ? ev : null;
      },
      logAuditForFile: () => seen.push('logAuditForFile'),
    });
    expect(written).toBe(1);
    expect(seen).toEqual(['dedupFileEvent', 'logAuditForFile', 'dedupFileEvent']);
  });
});

describe('the harness dispatch and the closed list of kinds', () => {
  it('executes every kind the schema declares, and declares every kind it executes', () => {
    // The parity `bench/lib/actor.js` keeps for step kinds: only the code that can
    // execute a kind may say which kinds exist. It could not be written before the
    // dispatch existed, which is why it lands with the harness and not with the format.
    expect([...harness.DISPATCHED_KINDS].sort()).toEqual([...schema.KIND_NAMES].sort());
  });

  it('refuses a kind the dispatch has never heard of', async () => {
    let err = null;
    try {
      await harness.replayRecord(
        { bench: { kind: 'fs.renamed', input: {} } },
        fakeWired(),
        recorder(),
        { advanceTo: () => {} },
      );
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.UNKNOWN_KIND);
  });
});
