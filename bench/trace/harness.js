/**
 * @file bench/trace/harness.js
 * @module bench/trace/harness
 * @description Pushes one recorded trace through the product's detection and
 *   attribution code, one record at a time.
 *
 *   WHAT IT REPRODUCES, AND WHY THAT IS A RISK WORTH NAMING. `handleWatcherEvent`
 *   does not write to the audit log: it pushes onto `activityLog` and calls
 *   `_state.onFileEvent`. The path from a detection to an Event Schema v1 record is
 *   closed OUTSIDE the watcher, in three places — `main.js`'s `onFileEvent`, and
 *   `scan-loop.js`'s `doFileScan` and `doHotReadScan`. None of those three is
 *   exported, so a replay has to perform the same steps itself.
 *
 *   That duplication is real, and it drifts silently by default: if an original grew
 *   a step, this file would keep replaying yesterday's wiring and the bench would stay
 *   green while measuring the wrong pipeline. {@link ORCHESTRATION} is what stops
 *   that. It declares, per site, the ordered calls this harness makes, and
 *   `tests/shared/bench-trace/orchestration-drift.test.js` derives the same sequence
 *   from the product's own source and fails when the two disagree. The declaration is
 *   not taken on trust either: the same suite injects recorders and checks that the
 *   harness really performs the calls it claims.
 *
 *   What is NOT reproduced, and does not need to be: the renderer batchers, the tray
 *   notification and the stats push. None of them leaves a byte on disk, so none of
 *   them is part of a verdict.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */

'use strict';

const schema = require('./schema');
const wiring = require('./wiring');

/**
 * How many microtask drains a fire-and-forget scan is given to settle.
 *
 * `doNetworkScan` returns `undefined` and finishes inside a promise chain, so a
 * replay has to wait for it. Every provider it reaches is served synchronously from
 * the trace, so the chain settles in a small, fixed number of turns; the bound exists
 * so that a chain which does NOT settle is reported as exactly that, rather than
 * becoming a scan the trace appears not to have produced.
 * @type {number}
 */
const DRAIN_LIMIT = 200;

/**
 * The orchestration each site performs, in order — the product's, and therefore this
 * harness's.
 *
 * Held against `src/main/main.js` and `src/main/scan-loop.js` by
 * `tests/shared/bench-trace/orchestration-drift.test.js`, which derives the same
 * sequences from their source. Editing this table without the product moving first is
 * how the guard is supposed to go red.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
const ORCHESTRATION = Object.freeze({
  /** `src/main/main.js`, the `onFileEvent` handler passed to `watcher.init`. */
  'fs.event': Object.freeze(['dedupFileEvent', 'logAuditForFile']),
  /** `src/main/scan-loop.js` `doFileScan`. */
  'handles.tick': Object.freeze(['scanAllFileHandles', 'dedupFileEvent', 'logAuditForFile']),
  /** `src/main/scan-loop.js` `doHotReadScan`. */
  'rm.hot.tick': Object.freeze(['scanHotFileHolders', 'dedupFileEvent', 'logAuditForFile']),
});

/**
 * Which product site each reproduced sequence was read off, so a failure names the
 * file and function to open rather than only the kind that broke.
 * @type {Readonly<Record<string, {file: string, anchor: string}>>}
 */
const ORCHESTRATION_SITES = Object.freeze({
  'fs.event': Object.freeze({ file: 'src/main/main.js', anchor: 'onFileEvent: (ev) =>' }),
  'handles.tick': Object.freeze({
    file: 'src/main/scan-loop.js',
    anchor: 'async function doFileScan(',
  }),
  'rm.hot.tick': Object.freeze({
    file: 'src/main/scan-loop.js',
    anchor: 'async function doHotReadScan(',
  }),
});

/**
 * Let the microtask queue run until a fire-and-forget scan reports it is done.
 * @param {() => boolean} settled - Whether the scan has finished.
 * @param {string} what - The scan's name, for the refusal.
 * @returns {Promise<void>}
 * @throws {import('./schema').TraceError} When it does not settle within the bound.
 */
async function drainUntil(settled, what) {
  for (let i = 0; i < DRAIN_LIMIT; i++) {
    if (settled()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  schema.refuse(
    schema.REFUSAL.RECORD_MALFORMED,
    `${what} did not settle within ${DRAIN_LIMIT} microtask drains. Every provider it reaches ` +
      'is served synchronously from the trace, so this is a harness fault, not an observation ' +
      'the recording failed to make',
  );
}

/**
 * The file pipeline as `main.js` and `scan-loop.js` close it: dedup, then audit.
 *
 * One definition rather than three copies, because all three sites perform exactly
 * these two steps on an event. The steps come in through `calls` so a suite can watch
 * them without this file growing a test hook.
 * @param {Object[]} events - What a detection produced.
 * @param {Object} calls - `{dedupFileEvent, logAuditForFile}`.
 * @returns {number} How many events survived dedup and reached the audit log.
 */
function pipeFileEvents(events, calls) {
  let written = 0;
  for (const event of events) {
    const deduped = calls.dedupFileEvent(event);
    if (!deduped) continue;
    calls.logAuditForFile(deduped);
    written += 1;
  }
  return written;
}

/**
 * Install the hook `main.js` installs, running the steps `main.js` runs.
 *
 * Its own function rather than four lines inside {@link replay}, so the suite can
 * exercise the SHIPPED hook instead of a copy of it: a drift guard that watched a
 * re-implementation of the thing it guards would be checking itself.
 * @param {Object} wired - What `wiring.setUp` returned. Gains an `fsWritten` counter.
 * @param {Object} calls - `{dedupFileEvent, logAuditForFile}`.
 * @returns {void}
 */
function installFileEventHook(wired, calls) {
  wired.fsWritten = 0;
  wired.state.onFileEvent = (event) => {
    wired.fsWritten += pipeFileEvents([event], calls);
  };
}

/**
 * Replay one record against the wired product.
 * @param {Object} record - A validated trace record.
 * @param {Object} wired - What `wiring.setUp` returned.
 * @param {Object} calls - The orchestration steps, injectable for observation.
 * @param {Object} clock - The installed virtual clock.
 * @returns {Promise<{kind: string, written: number}>}
 */
async function replayRecord(record, wired, calls, clock) {
  const { kind, input } = record.bench;
  const recordAmbient = record.bench.ambient;
  const { ambient, modules, providers } = wired;

  if (recordAmbient) {
    ambient.populationReliable = recordAmbient.populationReliable;
    ambient.isOtherPanelExpanded = recordAmbient.isOtherPanelExpanded;
  }

  switch (kind) {
    case 'population.set':
      ambient.agents = input.agents;
      return { kind, written: 0 };

    case 'clock.advance':
      clock.advanceTo(input.toEpochMs);
      return { kind, written: 0 };

    case 'fs.event': {
      // The product closes this path inside `main.js`'s `onFileEvent`, so the replay
      // closes it in the same place: `wiring` leaves the hook unset and `replay` sets
      // it to run exactly the two steps `main.js` runs. What arrives here is the same
      // object the watcher pushed, because it is the same callback the watcher calls.
      wired.fsWritten = 0;
      modules.fileWatcher.handleWatcherEvent(input.action, input.path);
      return { kind, written: wired.fsWritten };
    }

    case 'handles.tick': {
      providers.handlesByPid = input.byPid;
      const events = await calls.scanAllFileHandles(ambient.all());
      return { kind, written: pipeFileEvents(events, calls) };
    }

    case 'rm.hot.tick': {
      providers.rmHolders = input.holders;
      const events = await calls.scanHotFileHolders(ambient.all());
      return { kind, written: pipeFileEvents(events, calls) };
    }

    case 'net.tick': {
      providers.tcp = input.tcp;
      providers.dns = input.dns;
      modules.scanLoop.doNetworkScan();
      await drainUntil(() => !modules.networkMonitor.isNetworkScanRunning(), 'doNetworkScan');
      return { kind, written: 0 };
    }

    default:
      return schema.refuse(
        schema.REFUSAL.UNKNOWN_KIND,
        `the harness has no dispatch for bench.kind ${JSON.stringify(kind)}`,
      );
  }
}

/**
 * The dispatch's own view of which kinds it can execute.
 *
 * Derived from the dispatch rather than written beside it, so "the schema declares a
 * kind the harness cannot run" is a question a test can ask. `bench/lib/actor.js`
 * draws the same line for step kinds: only the code that can execute a kind may say
 * which kinds exist.
 * @type {ReadonlyArray<string>}
 */
const DISPATCHED_KINDS = Object.freeze([
  'population.set',
  'clock.advance',
  'fs.event',
  'handles.tick',
  'rm.hot.tick',
  'net.tick',
]);

/**
 * Replay a whole trace.
 * @param {Object} opts
 * @param {Object} opts.header - A validated header.
 * @param {Object[]} opts.records - Validated, chain-verified records.
 * @param {string} opts.runDir - Where this replay writes.
 * @param {Object} [opts.calls] - Orchestration steps, injectable for observation.
 * @param {Object} [opts.clock] - The clock. Defaults to the installed one.
 * @returns {Promise<{records: number, written: number, byKind: Object<string, number>,
 *   auditDir: string, auditFiles: string[], profileDir: string}>}
 */
async function replay(opts) {
  // setUp FIRST, and the order is deliberate: it performs the three clock checks with
  // messages that name what is wrong (absent / seeded for another trace / already
  // moved). Reaching for the clock handle before that would refuse first, with the
  // vaguer "there is none to advance".
  const wired = wiring.setUp({ header: opts.header, runDir: opts.runDir });
  const clock = opts.clock || require('./clock').currentClock();
  const calls = opts.calls || {
    dedupFileEvent: wired.modules.scanLoop.dedupFileEvent,
    logAuditForFile: wired.modules.scanLoop.logAuditForFile,
    scanAllFileHandles: (agents) => wired.modules.fileWatcher.scanAllFileHandles(agents),
    scanHotFileHolders: (agents) => wired.modules.fileWatcher.scanHotFileHolders(agents),
  };

  installFileEventHook(wired, calls);

  /** @type {Object<string, number>} */
  const byKind = {};
  let written = 0;
  /** @type {{auditDir: string, auditFiles: string[]}} Always assigned by the finally below. */
  let stopped;
  try {
    for (const record of opts.records) {
      const result = await replayRecord(record, wired, calls, clock);
      byKind[result.kind] = (byKind[result.kind] || 0) + 1;
      written += result.written;
    }
  } finally {
    // Always: a replay that threw halfway still has to stop the flush timer, or the
    // process never exits and the failure reads as a hang.
    stopped = wiring.tearDown(wired);
  }
  return {
    records: opts.records.length,
    written,
    byKind,
    auditDir: stopped.auditDir,
    auditFiles: stopped.auditFiles,
    profileDir: wired.profileDir,
  };
}

module.exports = {
  DISPATCHED_KINDS,
  DRAIN_LIMIT,
  ORCHESTRATION,
  ORCHESTRATION_SITES,
  drainUntil,
  installFileEventHook,
  pipeFileEvents,
  replay,
  replayRecord,
};
