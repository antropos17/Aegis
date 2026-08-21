/**
 * @file bench/trace/recorder.js
 * @module bench/trace/recorder
 * @description Records a trace: the same product graph a replay drives, wired through
 *   the same published seams, in the mirror posture — the providers are REAL, and
 *   every answer a sensor consumes is also written down, record-and-pass-through,
 *   bytes unchanged.
 *
 *   WHY THIS EXISTS. An arm-A run writes only the product's DECISIONS — the audit log
 *   `bench/lib/observed.js` reads back — never the sensors' INPUTS, so a trace cannot
 *   be derived from `observed.ndjson` or `observed.meta.json`: the information is
 *   simply not there. The missing piece is this input tap.
 *
 *   WHAT A RECORDING IS NOT. It is not an oracle. It is the system under test
 *   observing itself, so what a recording proves is REPLAYABILITY — the same bytes in
 *   produce the same verdicts out — never accuracy. Nothing here confirms that a
 *   sensor saw what the machine did; that is the measurement column's job, and the
 *   recorder deliberately lives on the other side of the `src/` boundary
 *   (`bench/README.md`, "Trace replay and the src/ boundary").
 *
 *   A RECORDING RUNS ON THE VIRTUAL CLOCK, and that is load-bearing. The product
 *   stamps `new Date().toISOString()` on every audit record it writes, so a recording
 *   on the wall clock could never replay to its own verdicts byte for byte — the
 *   replay's clock would move exactly as recorded while the wall clock had drifted
 *   between an observation and its audit write. Cadence therefore comes from the
 *   session ({@link Recording#advanceClock}), exactly as it comes from the trace in a
 *   replay, and {@link setUpRecording} refuses without the preload.
 *
 *   THE TAP APPENDS, THE WRITER DERIVES. During the run every observation is appended
 *   raw to `observations.ndjson`, one JSON line at a time. `trace.ndjson` and
 *   `trace.header.json` are then derived OFFLINE by {@link deriveTrace} through
 *   `./writer.js` — chained, neutralized, validated — never streamed live. The
 *   environment is observed at RECORDING time and carried through `recording.meta.json`,
 *   so the header pins the tree the recording actually ran against; a tree edited
 *   between record and derive becomes a digest mismatch at replay, not a silently
 *   re-pinned header.
 *
 *   NO NEW RECORD KINDS. Everything the recorder can observe is one of the six kinds
 *   `./schema.js` already declares, and every observation is validated against its
 *   kind BEFORE it is appended — a recorder must not be able to produce a trace the
 *   reader refuses. A provider answer the format cannot express (a handle scan that
 *   THREW, say) is marked unrecordable and fails {@link deriveTrace} by name instead
 *   of being dropped or invented.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */

'use strict';

const dns = require('dns');
const fs = require('fs');
const path = require('path');

const clockModule = require('./clock');
const environment = require('./environment');
const harness = require('./harness');
const schema = require('./schema');
const wiring = require('./wiring');
const writer = require('./writer');

/** @type {string} Raw observations, appended one JSON line at a time during the run. */
const OBSERVATIONS_FILENAME = 'observations.ndjson';

/** @type {string} What the recording pinned at setup: clock epoch, settings, environment. */
const META_FILENAME = 'recording.meta.json';

/** @type {string} Written by {@link Recording#finish}; its absence means the run never stopped cleanly. */
const DONE_FILENAME = 'recording.done.json';

/** @type {number} The raw recording layout's version, checked by {@link deriveTrace}. */
const RECORDING_SCHEMA_VERSION = 1;

/**
 * The scope every recorder-made trace declares. Same answers, same reasons as the
 * replay suites give: the recorder drives exactly the phase-1 surface the harness
 * replays, so what a replay cannot reach, a recording cannot record.
 * @returns {Object} A fresh scope object in the `{value, unavailable}` convention.
 */
function recorderScope() {
  return {
    processTicks: { value: null, unavailable: 'scan-loop.doProcessScan is not exported' },
    anomalyAlerts: { value: null, unavailable: 'out-of-scope-phase-1' },
    rmFullPath: { value: null, unavailable: 'the getSensitiveHolders injection is one-way' },
  };
}

/**
 * A JSON snapshot of a provider answer, taken at the instant it passed through.
 * `undefined` survives as `undefined` so an absent value stays absent.
 * @param {*} value
 * @returns {*}
 */
function snapshot(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * The REAL providers a production recording wraps — the same functions the product
 * modules hold as their own un-injected defaults.
 *
 * Required lazily so that requiring THIS module does not pull the platform into a
 * process that only wanted {@link deriveTrace}. `getFileHandles`,
 * `getHotSensitiveHolders` and `getRawTcpConnections` are literally the defaults of
 * `src/main/file-watcher.js` and `src/main/network-monitor.js` (their module-level
 * `_platform.*` bindings). The two DNS functions cannot be reached that way — the
 * product wraps them in module-private closures — so they are MIRRORED here from
 * `network-monitor.js` (`_dnsReverse`, `_dnsResolve`): resolve4/resolve6 over
 * authoritative DNS, never `dns.lookup`, because a hosts file an attacker on the box
 * can write is not evidence about a remote endpoint. That mirror is a named drift
 * point — see bench/README.md, "Recording a trace".
 * @returns {Object} `{getFileHandles, getHotSensitiveHolders, getRawTcpConnections,
 *   dnsReverse, dnsResolve}` — `getHotSensitiveHolders` is `undefined` off win32.
 */
function realProviders() {
  const platform = require('../../src/main/platform');
  return {
    getFileHandles: platform.getFileHandles,
    getHotSensitiveHolders: platform.getHotSensitiveHolders,
    getRawTcpConnections: platform.getRawTcpConnections,
    dnsReverse: (ip) => dns.promises.reverse(ip),
    dnsResolve: async (hostname) => {
      const settled = await Promise.allSettled([
        dns.promises.resolve4(hostname),
        dns.promises.resolve6(hostname),
      ]);
      const out = [];
      for (const r of settled) if (r.status === 'fulfilled') out.push(...r.value);
      return out;
    },
  };
}

/**
 * The record-and-pass-through wrappers around one set of providers.
 *
 * Every wrapper returns EXACTLY what the wrapped provider returned — the same object,
 * the same rejection — and writes a {@link snapshot} into the buffer of the tick that
 * is currently open. An answer arriving with no tick open, or a non-DNS provider that
 * THREW, is an observation the trace format cannot express: it is recorded as
 * unrecordable and fails {@link deriveTrace} by name, because a recorder that dropped
 * it would produce a trace claiming the run consumed less than it did.
 */
class Tap {
  /** @param {Object} given - The providers to wrap. */
  constructor(given) {
    /** @type {Array<{provider: string, why: string}>} What the trace format could not hold. */
    this.unrecordable = [];
    /** @type {string|null} Which tick is collecting: 'handles' | 'rm' | 'net' | null. */
    this.active = null;
    /** @type {Object<string, string[]>} Per-pid answers of the open handles tick. */
    this.byPid = {};
    /** @type {Object[]} Holder answers of the open rm tick. */
    this.holders = [];
    /** @type {Object[]} The TCP answer of the open net tick. */
    this.tcp = [];
    /** @type {Object<string, {reverse: string[]|null, forward: string[]|null}>} */
    this.dns = {};
    /** @type {boolean} Whether the open net tick saw a TCP read at all. */
    this.tcpObserved = false;

    this.wrapped = this._wrap(given);
  }

  /**
   * Open one tick's buffer.
   * @param {string} what - 'handles' | 'rm' | 'net'.
   * @returns {void}
   */
  begin(what) {
    this.active = what;
    this.byPid = {};
    this.holders = [];
    this.tcp = [];
    this.dns = {};
    this.tcpObserved = false;
  }

  /**
   * Close the open tick's buffer and hand back what it collected.
   * @returns {{byPid: Object, holders: Object[], tcp: Object[], dns: Object,
   *   tcpObserved: boolean}}
   */
  end() {
    const collected = {
      byPid: this.byPid,
      holders: this.holders,
      tcp: this.tcp,
      dns: this.dns,
      tcpObserved: this.tcpObserved,
    };
    this.active = null;
    return collected;
  }

  /**
   * Note an answer the trace format cannot carry. The recording keeps running —
   * the product's behaviour is not changed — but {@link deriveTrace} will refuse.
   * @param {string} provider - Which provider produced it.
   * @param {string} why - What could not be recorded.
   * @returns {void}
   */
  markUnrecordable(provider, why) {
    this.unrecordable.push({ provider, why });
  }

  /**
   * Attribute one forward answer to the first recorded ip whose reverse answer
   * includes the hostname — the SAME rule the replay's `dnsResolve` applies
   * (`./wiring.js`), in the same insertion order, so a recording and its replay
   * agree about which entry a forward answer lives on.
   * @param {string} hostname
   * @param {string[]|null} forward - The answer, or `null` for "the lookup threw".
   * @returns {void}
   */
  _attributeForward(hostname, forward) {
    for (const answer of Object.values(this.dns)) {
      if (answer.reverse && answer.reverse.includes(hostname)) {
        answer.forward = forward;
        return;
      }
    }
    // A real answer with no recorded reverse to hang it on cannot be replayed —
    // wiring's dnsResolve would reject where the recording resolved. A THROWN one
    // needs no record at all: the replay rejects an unknown hostname by itself.
    if (forward !== null) {
      this.markUnrecordable(
        'dnsResolve',
        `a forward answer for ${JSON.stringify(hostname)} arrived with no recorded reverse ` +
          'answer naming that hostname, so no net.tick entry can carry it',
      );
    }
  }

  /**
   * Build the wrappers.
   * @param {Object} given - The providers to wrap.
   * @returns {Object} The wrapped set, shaped for `wiring.wireGraph`.
   */
  _wrap(given) {
    const tap = this;
    return {
      getFileHandles: async (pid) => {
        let files;
        try {
          files = await given.getFileHandles(pid);
        } catch (err) {
          tap.markUnrecordable(
            'getFileHandles',
            `threw for pid ${pid} (${err.message}) — the trace format records answers, ` +
              'and a handle scan that failed is not one',
          );
          throw err;
        }
        if (tap.active === 'handles') tap.byPid[String(pid)] = snapshot(files) || [];
        else tap.markUnrecordable('getFileHandles', `answered pid ${pid} outside a handles tick`);
        return files;
      },
      getHotSensitiveHolders:
        typeof given.getHotSensitiveHolders === 'function'
          ? async () => {
              let holders;
              try {
                holders = await given.getHotSensitiveHolders();
              } catch (err) {
                tap.markUnrecordable(
                  'getHotSensitiveHolders',
                  `threw (${err.message}) — the trace format records answers, and a hot ` +
                    'cycle that failed is not one',
                );
                throw err;
              }
              if (tap.active === 'rm') tap.holders = snapshot(holders) || [];
              else tap.markUnrecordable('getHotSensitiveHolders', 'answered outside an rm tick');
              return holders;
            }
          : undefined,
      getRawTcpConnections: async (pids) => {
        let raw;
        try {
          raw = await given.getRawTcpConnections(pids);
        } catch (err) {
          tap.markUnrecordable(
            'getRawTcpConnections',
            `threw (${err.message}) — the trace format records answers, and a TCP read ` +
              'that failed is not one',
          );
          throw err;
        }
        if (tap.active === 'net') {
          tap.tcp = snapshot(raw) || [];
          tap.tcpObserved = true;
        } else {
          tap.markUnrecordable('getRawTcpConnections', 'answered outside a net tick');
        }
        return raw;
      },
      dnsReverse: async (ip) => {
        // A throw IS a recordable observation here: the format's `null` means
        // exactly "the lookup threw", so the rejection is written down and
        // re-thrown unchanged.
        try {
          const answer = await given.dnsReverse(ip);
          if (tap.active === 'net') tap.dns[ip] = { reverse: snapshot(answer), forward: null };
          else tap.markUnrecordable('dnsReverse', `answered ${ip} outside a net tick`);
          return answer;
        } catch (err) {
          if (tap.active === 'net') tap.dns[ip] = { reverse: null, forward: null };
          else tap.markUnrecordable('dnsReverse', `threw for ${ip} outside a net tick`);
          throw err;
        }
      },
      dnsResolve: async (hostname) => {
        try {
          const answer = await given.dnsResolve(hostname);
          if (tap.active === 'net') tap._attributeForward(hostname, snapshot(answer));
          else tap.markUnrecordable('dnsResolve', `answered ${hostname} outside a net tick`);
          return answer;
        } catch (err) {
          if (tap.active === 'net') tap._attributeForward(hostname, null);
          else tap.markUnrecordable('dnsResolve', `threw for ${hostname} outside a net tick`);
          throw err;
        }
      },
    };
  }
}

/**
 * One live recording: the driver's handle onto the wired, tapped product.
 *
 * The methods ARE the session — a scripted recording calls them in whatever order
 * the session it stages requires, and each one both drives the product (through the
 * same calls the replay harness makes) and appends what was observed.
 */
class Recording {
  /**
   * @param {Object} opts - Assembled by {@link setUpRecording}; not for direct use.
   */
  constructor(opts) {
    /** @type {string} */
    this.runDir = opts.runDir;
    /** @type {string} */
    this.observationsPath = opts.observationsPath;
    /** @type {Tap} */
    this.tap = opts.tap;
    /** @type {Object} What `wiring.wireGraph` returned. */
    this.wired = opts.wired;
    /** @type {Object} The orchestration steps, the same set `harness.replay` builds. */
    this.calls = opts.calls;
    /** @type {Object} The installed virtual clock. */
    this.clock = opts.clock;
    /** @type {boolean} */
    this._finished = false;
  }

  /**
   * Append one raw observation line. Validated against its kind FIRST, so a line
   * that reaches the file is one the writer will accept and the reader will read.
   * @param {string} kind - One of `schema.KIND_NAMES`.
   * @param {Object} input - The observation, in the kind's declared shape.
   * @param {number} [epochMs] - The instant to stamp. Defaults to now (virtual).
   * @returns {void}
   */
  _append(kind, input, epochMs) {
    if (this._finished) {
      schema.refuse(
        schema.REFUSAL.RECORD_MALFORMED,
        'this recording has finished — the audit log is flushed and the raw file is closed, ' +
          'so a later observation would describe a product that is no longer running',
      );
    }
    schema.validateInput(kind, input, 'recording: ');
    const observation = { kind, epochMs: epochMs != null ? epochMs : Date.now(), input };
    if (schema.RECORD_KINDS[kind].observation) {
      observation.ambient = {
        populationReliable: this.wired.ambient.populationReliable,
        isOtherPanelExpanded: this.wired.ambient.isOtherPanelExpanded,
      };
    }
    fs.appendFileSync(this.observationsPath, `${JSON.stringify(observation)}\n`, 'utf8');
  }

  /**
   * Hand the sensors a new agent population, and record that it was handed.
   * @param {Object[]} agents - In the shape `population.set` declares.
   * @returns {void}
   */
  setPopulation(agents) {
    this._append('population.set', { agents: snapshot(agents) });
    this.wired.ambient.agents = agents;
  }

  /**
   * Set the ambient facts that ride each observation record. Not an observation
   * itself — the snapshot is written per record, exactly where a replay reads it.
   * @param {Object} partial - `{populationReliable?, isOtherPanelExpanded?}`.
   * @returns {void}
   */
  setAmbient(partial) {
    if (typeof partial.populationReliable === 'boolean') {
      this.wired.ambient.populationReliable = partial.populationReliable;
    }
    if (typeof partial.isOtherPanelExpanded === 'boolean') {
      this.wired.ambient.isOtherPanelExpanded = partial.isOtherPanelExpanded;
    }
  }

  /**
   * Move the virtual clock forward, and record the move.
   *
   * Advanced FIRST, appended second: `advanceTo` refuses a backwards or invalid
   * instant, and a refused move must leave no record claiming it happened. The
   * appended `epochMs` is captured before the move, the same instant convention the
   * replay suites' fixtures use.
   * @param {number} toEpochMs
   * @returns {void}
   */
  advanceClock(toEpochMs) {
    const before = Date.now();
    this.clock.advanceTo(toEpochMs);
    this._append('clock.advance', { toEpochMs }, before);
  }

  /**
   * Deliver one filesystem event, exactly as the watcher would deliver it, and
   * close the pipeline the way `main.js` closes it (dedup → audit, via the hook
   * `harness.installFileEventHook` installed).
   * @param {string} action - `created` | `modified` | `deleted`.
   * @param {string} filePath - The path, exactly as observed.
   * @returns {{written: number}} How many events survived dedup and reached the audit log.
   */
  fsEvent(action, filePath) {
    this._append('fs.event', { action, path: filePath });
    this.wired.fsWritten = 0;
    this.wired.modules.fileWatcher.handleWatcherEvent(action, filePath);
    return { written: this.wired.fsWritten };
  }

  /**
   * Run one full handle scan — `scan-loop.js doFileScan`'s orchestration — and
   * record the per-pid answers the real provider gave.
   *
   * An empty population records an empty `byPid`: the scan ran and consulted
   * nobody, which is exactly what a replay of that record reproduces.
   * @returns {Promise<{written: number}>}
   */
  async handlesTick() {
    this.tap.begin('handles');
    let events;
    let collected;
    try {
      events = await this.calls.scanAllFileHandles(this.wired.ambient.all());
    } finally {
      collected = this.tap.end();
    }
    this._append('handles.tick', { byPid: collected.byPid });
    return { written: harness.pipeFileEvents(events, this.calls) };
  }

  /**
   * Run one Restart Manager hot cycle — `scan-loop.js doHotReadScan`'s
   * orchestration — and record the holders the real provider reported.
   * @returns {Promise<{written: number}>}
   */
  async rmHotTick() {
    if (typeof this.tap.wrapped.getHotSensitiveHolders !== 'function') {
      schema.refuse(
        schema.REFUSAL.RECORD_MALFORMED,
        'this recording has no getHotSensitiveHolders provider (the platform default exists ' +
          'on win32 only), so an rm.hot.tick cannot be observed — there is nothing to record',
      );
    }
    this.tap.begin('rm');
    let events;
    let collected;
    try {
      events = await this.calls.scanHotFileHolders(this.wired.ambient.all());
    } finally {
      collected = this.tap.end();
    }
    this._append('rm.hot.tick', { holders: collected.holders });
    return { written: harness.pipeFileEvents(events, this.calls) };
  }

  /**
   * Run one network scan — the product's own fire-and-forget `doNetworkScan`,
   * drained the way the replay harness drains it — and record the TCP table and
   * the DNS answers it consumed.
   * @returns {Promise<void>}
   */
  async netTick() {
    this.tap.begin('net');
    let collected;
    try {
      this.wired.modules.scanLoop.doNetworkScan();
      await harness.drainUntil(
        () => !this.wired.modules.networkMonitor.isNetworkScanRunning(),
        'doNetworkScan',
      );
    } finally {
      collected = this.tap.end();
    }
    if (!collected.tcpObserved) {
      schema.refuse(
        schema.REFUSAL.RECORD_MALFORMED,
        'doNetworkScan consulted no provider on this tick — an empty population makes the ' +
          'scan a no-op, and recording an observation nobody made would invent one',
      );
    }
    this._append('net.tick', { tcp: collected.tcp, dns: collected.dns });
  }

  /**
   * Stop the product cleanly (its own `audit.shutdown`), and seal the recording.
   *
   * Writes `recording.done.json` — {@link deriveTrace} refuses a recording without
   * it, because an unfinished recording's audit log is missing its buffered tail.
   * @returns {{auditDir: string, auditFiles: string[], observationsPath: string,
   *   unrecordable: Array<{provider: string, why: string}>}}
   */
  finish() {
    const stopped = wiring.tearDown(this.wired);
    this._finished = true;
    const done = {
      auditFiles: stopped.auditFiles,
      unrecordable: this.tap.unrecordable,
    };
    fs.writeFileSync(path.join(this.runDir, DONE_FILENAME), `${JSON.stringify(done, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    return { ...stopped, observationsPath: this.observationsPath, unrecordable: done.unrecordable };
  }
}

/**
 * Wire the product for one recording.
 *
 * @param {Object} opts
 * @param {string} opts.runDir - Directory this recording writes into. Created here.
 * @param {Object} [opts.providers] - The providers to wrap. Defaults to
 *   {@link realProviders}; a test injects scripted ones through the same door.
 * @param {Object} [opts.settings] - Settings the sensors run under. Defaults to `{}`.
 * @returns {Recording}
 * @throws {import('./schema').TraceError} When no virtual clock is installed, the
 *   clock has already been moved, the directory already holds a recording, or a
 *   graph was already wired in this process.
 */
function setUpRecording(opts) {
  // BEFORE the product is loaded, for the same reason `wiring.setUp` gives: the
  // preload has to have run before any product module was compiled, and a recording
  // on the wall clock cannot replay to its own verdicts byte for byte.
  if (!clockModule.isInstalled()) {
    schema.refuse(
      schema.REFUSAL.RECORD_MALFORMED,
      'no virtual clock is installed. Run the recording entrypoint with ' +
        '`node --require bench/trace/preload.js` — a recording on the wall clock produces a ' +
        'trace that can never replay to the verdicts its own run wrote',
    );
  }
  const clockEpochMs = clockModule.installedEpochMs();
  if (Date.now() !== clockEpochMs) {
    schema.refuse(
      schema.REFUSAL.RECORD_MALFORMED,
      `Date.now() reads ${Date.now()} where the installed clock was seeded at ${clockEpochMs} — ` +
        'something moved the clock before the recording started, so its first observation ' +
        'would not sit at the epoch the derived header declares',
    );
  }

  const settings = opts.settings || {};
  const tap = new Tap(opts.providers || realProviders());
  // Wired BEFORE the meta file is written, so a refused wiring — above all the
  // one-graph-per-process latch — leaves no recording directory behind it.
  const wired = wiring.wireGraph({
    runDir: opts.runDir,
    settings,
    fileWatcherDeps: {
      getFileHandles: tap.wrapped.getFileHandles,
      getHotSensitiveHolders: tap.wrapped.getHotSensitiveHolders,
    },
    networkMonitorDeps: {
      getRawTcpConnections: tap.wrapped.getRawTcpConnections,
      dnsReverse: tap.wrapped.dnsReverse,
      dnsResolve: tap.wrapped.dnsResolve,
    },
  });

  // The environment is observed NOW and pinned into the meta file: the header a
  // derivation builds must describe the tree the recording ran against, not the
  // tree that happens to be on disk when someone derives. (Reading the tree, not
  // the wired modules — the order against `wireGraph` carries no information.)
  const env = environment.observeEnvironment({ clockEpochMs });

  const metaPath = path.join(opts.runDir, META_FILENAME);
  const meta = {
    recordingSchemaVersion: RECORDING_SCHEMA_VERSION,
    clockEpochMs,
    settings,
    env,
  };
  try {
    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (err) {
    schema.refuse(
      schema.REFUSAL.FILE_UNREADABLE,
      `${metaPath} could not be created (${err.message}) — a recording directory is written ` +
        'once, and one that already holds a recording is never overwritten',
    );
  }

  // The same orchestration steps `harness.replay` builds, closing the same
  // dedup → audit pipeline through the same hook. One definition of the product's
  // wiring, two postures — see `harness.ORCHESTRATION` for the drift guard.
  const calls = {
    dedupFileEvent: wired.modules.scanLoop.dedupFileEvent,
    logAuditForFile: wired.modules.scanLoop.logAuditForFile,
    scanAllFileHandles: (agents) => wired.modules.fileWatcher.scanAllFileHandles(agents),
    scanHotFileHolders: (agents) => wired.modules.fileWatcher.scanHotFileHolders(agents),
  };
  harness.installFileEventHook(wired, calls);

  return new Recording({
    runDir: opts.runDir,
    observationsPath: path.join(opts.runDir, OBSERVATIONS_FILENAME),
    tap,
    wired,
    calls,
    clock: clockModule.currentClock(),
  });
}

/**
 * Derive a replayable trace directory from a finished recording. OFFLINE: no clock,
 * no product — this reads three files and drives `./writer.js`.
 *
 * @param {Object} opts
 * @param {string} opts.runDir - The recording directory.
 * @param {string} opts.traceDir - Where the trace is written. Refused if it holds one.
 * @param {string} opts.id - The trace id; also the name a replay knows it by.
 * @returns {{headerPath: string, tracePath: string, records: number}}
 * @throws {import('./schema').TraceError} When the recording is absent, unfinished,
 *   unreadable, empty, holds unrecordable observations, or an observation does not
 *   fit its kind.
 */
function deriveTrace(opts) {
  const metaPath = path.join(opts.runDir, META_FILENAME);
  const donePath = path.join(opts.runDir, DONE_FILENAME);
  const observationsPath = path.join(opts.runDir, OBSERVATIONS_FILENAME);

  const meta = readJson(metaPath, 'the recording meta file');
  if (meta.recordingSchemaVersion !== RECORDING_SCHEMA_VERSION) {
    schema.refuse(
      schema.REFUSAL.SCHEMA_VERSION,
      `the recording declares recordingSchemaVersion ${JSON.stringify(meta.recordingSchemaVersion)} ` +
        `and this deriver speaks version ${RECORDING_SCHEMA_VERSION}`,
    );
  }
  // Both refusals guard the same property: the header is built from what the
  // RECORDING pinned, never from what happens to be observable at derive time.
  // `writer.buildHeader` would observe the current tree when `env` is absent —
  // exactly the silent re-pin the meta file exists to prevent — and a clockless
  // meta would build a header the reader refuses, which a recorder must not produce.
  if (!Number.isSafeInteger(meta.clockEpochMs)) {
    schema.refuse(
      schema.REFUSAL.RECORD_MALFORMED,
      `${metaPath} does not carry clockEpochMs as a safe integer — a trace whose clock nobody ` +
        'recorded cannot declare where a replay starts',
    );
  }
  if (!schema.isObject(meta.env)) {
    schema.refuse(
      schema.REFUSAL.RECORD_MALFORMED,
      `${metaPath} does not carry the environment observed at recording time — deriving against ` +
        'the tree on disk today would silently re-pin the header to a tree the recording ' +
        'never ran against',
    );
  }
  let done;
  try {
    done = readJson(donePath, 'the recording done file');
  } catch (err) {
    schema.refuse(
      schema.REFUSAL.FILE_UNREADABLE,
      `${donePath}: ${err.message}. A recording without its done file never finished — its ` +
        'audit log is missing the buffered tail, so a trace derived from it would replay to ' +
        'verdicts the recording itself does not hold',
    );
  }
  if (Array.isArray(done.unrecordable) && done.unrecordable.length > 0) {
    const listed = done.unrecordable.map((u) => `${u.provider}: ${u.why}`).join('; ');
    schema.refuse(
      schema.REFUSAL.RECORD_MALFORMED,
      `the recording holds ${done.unrecordable.length} observation(s) the trace format cannot ` +
        `express (${listed}) — a trace that silently dropped them would claim the run consumed ` +
        'less than it did',
    );
  }

  let text;
  try {
    text = fs.readFileSync(observationsPath, 'utf8');
  } catch (err) {
    return schema.refuse(
      schema.REFUSAL.FILE_UNREADABLE,
      `the raw observations could not be read at ${observationsPath}: ${err.message}`,
    );
  }
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    schema.refuse(
      schema.REFUSAL.EMPTY_TRACE,
      `${observationsPath} holds no observations — a recording that captured nothing derives ` +
        'to an empty trace, and the reader refuses one of those by the same name',
    );
  }

  const unchained = lines.map((line, i) => {
    let observation;
    try {
      observation = JSON.parse(line);
    } catch (err) {
      return schema.refuse(
        schema.REFUSAL.RECORD_MALFORMED,
        `${OBSERVATIONS_FILENAME} line ${i} does not parse: ${err.message}`,
      );
    }
    return writer.buildRecord({
      trace: opts.id,
      seq: i,
      kind: observation.kind,
      epochMs: observation.epochMs,
      input: observation.input,
      ambient: observation.ambient,
    });
  });

  const header = writer.buildHeader({
    id: opts.id,
    clockEpochMs: meta.clockEpochMs,
    env: meta.env,
    settings: meta.settings,
    scope: recorderScope(),
    provenance: {
      source: 'bench/trace/recorder.js',
      derivedFrom: opts.runDir,
      observations: OBSERVATIONS_FILENAME,
    },
  });
  const written = writer.writeTrace(opts.traceDir, header, writer.chainRecords(unchained));
  return { ...written, records: unchained.length };
}

/**
 * Read and parse one JSON file, refusing rather than throwing a bare error.
 * @param {string} filePath
 * @param {string} label
 * @returns {*}
 * @throws {import('./schema').TraceError} `file-unreadable`.
 */
function readJson(filePath, label) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return schema.refuse(
      schema.REFUSAL.FILE_UNREADABLE,
      `${label} could not be read at ${filePath}: ${err.message}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return schema.refuse(
      schema.REFUSAL.FILE_UNREADABLE,
      `${label} at ${filePath} does not parse: ${err.message}`,
    );
  }
}

module.exports = {
  DONE_FILENAME,
  META_FILENAME,
  OBSERVATIONS_FILENAME,
  RECORDING_SCHEMA_VERSION,
  Recording,
  Tap,
  deriveTrace,
  realProviders,
  recorderScope,
  setUpRecording,
};
