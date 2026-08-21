/**
 * @file tests/shared/bench-trace/harness-replay.test.js
 * @description The claim the whole phase exists to make: same bytes in, same verdicts
 *   out — checked end to end, in real child processes, against the product's own
 *   records.
 *
 *   THE TRACE IS BUILT HERE, not committed. Committed seed traces are derived from a
 *   real run and arrive later; this suite needs a trace whose paths the current
 *   platform can resolve, so it writes one with the shipped `writer` and replays that.
 *   What it proves is the mechanism — the wiring, the clock, the verdict — not the
 *   accuracy of any recording.
 *
 *   IT SPAWNS RATHER THAN CALLS. `replay-trace.js` must run under
 *   `node --require bench/trace/preload.js`, because the clock has to be installed
 *   before any product module is compiled. Calling `harness.replay()` from inside a
 *   vitest worker would test the dispatch and quietly skip the thing most likely to
 *   break. It also means the one-replay-per-process rule holds naturally: each run is
 *   its own process, which is exactly how a real replay is invoked.
 *
 *   The negative case is spawned too — the same trace with the flag left off — because
 *   a suite that only ever runs the working path proves the command ran, not that it
 *   inspected anything.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import paths from '../../../bench/lib/paths.js';
import clockEnv from '../../../bench/trace/clock-env.js';
import environment from '../../../bench/trace/environment.js';
import replayTrace from '../../../bench/trace/replay-trace.js';
import writer from '../../../bench/trace/writer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const PRELOAD = path.join(REPO_ROOT, 'bench', 'trace', 'preload.js');
const ENTRY = path.join(REPO_ROOT, 'bench', 'trace', 'replay-trace.js');

/** @type {number} 2026-08-21T09:13:52.000Z. One instant, chosen once, never derived. */
const EPOCH_MS = 1_787_303_632_000;

/**
 * The zone every child runs in.
 *
 * Read off the header rather than chosen, because the runtime CANONICALIZES a zone
 * name: setting `TZ=Etc/UTC` makes `Intl` report `UTC`, and a header naming the alias
 * would then be refused for a difference that is not one. A header always carries what
 * `observeEnvironment` read, so passing that value straight back is the round-trip
 * that holds — and it is exactly what a runner does with a real recording.
 * @type {string}
 */
let TZ;

/** @type {string} Scratch root for this suite. */
let scratch;
/** @type {string} The trace every case replays. */
let traceDir;
/** @type {string} The project directory the recorded agent claims as its cwd. */
let projDir;

/**
 * Build the trace this suite replays.
 *
 * Six observations, chosen so that between them they reach five of the eight evidence
 * codes — every one the phase-1 surface can produce without a scenario that has not
 * been recorded yet.
 * @returns {string} The trace directory.
 */
function buildTrace() {
  const base = path.join(scratch, 'stage');
  projDir = path.join(base, 'proj');
  const elsewhere = path.join(base, 'elsewhere');
  const trace = 'T0-harness-mechanism';

  const agent = {
    agent: 'Claude Code',
    pid: 4812,
    process: 'claude.exe',
    instanceId: `4812:${EPOCH_MS}`,
    cwd: projDir,
    category: 'ai',
    parentEditor: null,
  };
  const online = { populationReliable: true, isOtherPanelExpanded: false };
  const offline = { populationReliable: false, isOtherPanelExpanded: false };

  const unchained = [
    writer.buildRecord({
      trace,
      seq: 0,
      kind: 'population.set',
      epochMs: EPOCH_MS,
      input: { agents: [agent] },
    }),
    // Its OWN config dir: self-config-path wins over cwd containment, and the
    // self-access exemption clears `sensitive` even though a rule matched.
    writer.buildRecord({
      trace,
      seq: 1,
      kind: 'fs.event',
      epochMs: EPOCH_MS + 10,
      input: { action: 'created', path: path.join(projDir, '.claude', 'settings.json') },
      ambient: online,
    }),
    // Inside the agent's cwd, matching a rule, not its own config: cwd-containment.
    writer.buildRecord({
      trace,
      seq: 2,
      kind: 'fs.event',
      epochMs: EPOCH_MS + 20,
      input: { action: 'created', path: path.join(projDir, '.env') },
      ambient: online,
    }),
    // Outside every cwd, with a population that IS trusted: no-owner-match.
    writer.buildRecord({
      trace,
      seq: 3,
      kind: 'fs.event',
      epochMs: EPOCH_MS + 30,
      input: { action: 'created', path: path.join(elsewhere, '.env') },
      ambient: online,
    }),
    // The same shape of path with the population UNREADABLE: population-unavailable,
    // and deliberately not no-owner-match — nothing was looked for.
    writer.buildRecord({
      trace,
      seq: 4,
      kind: 'fs.event',
      epochMs: EPOCH_MS + 40,
      input: { action: 'deleted', path: path.join(elsewhere, 'other.env') },
      ambient: offline,
    }),
    writer.buildRecord({
      trace,
      seq: 5,
      kind: 'clock.advance',
      epochMs: EPOCH_MS + 40,
      input: { toEpochMs: EPOCH_MS + 31_000 },
    }),
    // A scan run FOR this pid: handle-scan-pid, the confirmed branch.
    writer.buildRecord({
      trace,
      seq: 6,
      kind: 'handles.tick',
      epochMs: EPOCH_MS + 31_000,
      input: { byPid: { 4812: [path.join(projDir, 'secrets', 'id_rsa')] } },
      ambient: online,
    }),
    // A socket the OS attributes to the same pid: os-tcp-owner-pid. The reverse lookup
    // is recorded as having THROWN (`null`), which is not the same as an empty answer.
    writer.buildRecord({
      trace,
      seq: 7,
      kind: 'net.tick',
      epochMs: EPOCH_MS + 31_010,
      input: {
        tcp: [{ pid: 4812, ip: '203.0.113.10', port: 443, state: 'Established' }],
        dns: { '203.0.113.10': { reverse: null, forward: null } },
      },
      ambient: online,
    }),
  ];

  const dir = path.join(scratch, 'trace');
  const env = environment.observeEnvironment({ clockEpochMs: EPOCH_MS });
  const header = writer.buildHeader({
    id: trace,
    clockEpochMs: EPOCH_MS,
    env,
    settings: {},
    provenance: { source: 'built by tests/shared/bench-trace/harness-replay.test.js' },
    scope: {
      processTicks: { value: null, unavailable: 'scan-loop.doProcessScan is not exported' },
      anomalyAlerts: { value: null, unavailable: 'out-of-scope-phase-1' },
      rmFullPath: { value: null, unavailable: 'the getSensitiveHolders injection is one-way' },
    },
  });
  TZ = header.tz.name;
  writer.writeTrace(dir, header, writer.chainRecords(unchained));
  return dir;
}

/**
 * Run the entrypoint in a child process.
 * @param {Object} opts
 * @param {string} opts.outDir - Where the replay writes.
 * @param {boolean} [opts.withPreload=true] - Whether to install the clock.
 * @param {string} [opts.traceDir] - Trace to replay. Defaults to this suite's.
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function runReplay(opts) {
  const args = [];
  if (opts.withPreload !== false) args.push('--require', PRELOAD);
  args.push(ENTRY, opts.traceDir || traceDir, '--out', opts.outDir);
  const env = { ...process.env, [clockEnv.EPOCH_ENV]: String(EPOCH_MS), [clockEnv.TZ_ENV]: TZ };
  // Only for the no-preload case: hand the child the zone directly, so the reader's
  // time-zone check passes and the CLOCK guard is the one that fires. Without this the
  // negative case would be refused a step earlier and prove something else.
  if (opts.withPreload === false) env.TZ = TZ;
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: REPO_ROOT, env });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/**
 * Read a verdict file as parsed records.
 * @param {string} outDir
 * @returns {Object[]}
 */
function verdictRecords(outDir) {
  const text = fs.readFileSync(path.join(outDir, replayTrace.VERDICT_FILENAME), 'utf8');
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-harness-test-'));
  traceDir = buildTrace();
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('replay-trace — the invocation', () => {
  it('refuses an invocation with no trace and says so with exit 2', () => {
    const out = path.join(scratch, 'unused');
    const args = ['--require', PRELOAD, ENTRY, '--out', out];
    const env = { ...process.env, [clockEnv.EPOCH_ENV]: String(EPOCH_MS), [clockEnv.TZ_ENV]: TZ };
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: REPO_ROOT, env });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('no trace directory given');
  });

  it('parses its flags without touching a filesystem', () => {
    expect(replayTrace.parseArgs(['dir'])).toEqual({ traceDir: 'dir', outDir: null });
    expect(replayTrace.parseArgs(['dir', '--out', 'x'])).toEqual({ traceDir: 'dir', outDir: 'x' });
    expect(replayTrace.parseArgs([]).error).toContain('no trace directory');
    expect(replayTrace.parseArgs(['--nope']).error).toContain('unknown flag');
    expect(replayTrace.parseArgs(['a', 'b']).error).toContain('one trace directory');
    expect(replayTrace.parseArgs(['a', '--out']).error).toContain('--out needs');
  });

  it('WITHOUT the preload it refuses rather than replaying on the wall clock', () => {
    // The case that makes the passing ones mean something: a replay that quietly ran
    // on real time would produce a plausible verdict nobody could reproduce.
    const out = path.join(scratch, 'no-clock');
    const result = runReplay({ outDir: out, withPreload: false });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no virtual clock is installed');
    expect(fs.existsSync(path.join(out, replayTrace.VERDICT_FILENAME))).toBe(false);
  });
});

describe('replay-trace — the verdict', () => {
  /** @type {string} */
  let firstOut;

  beforeAll(() => {
    firstOut = path.join(scratch, 'run-a');
    const result = runReplay({ outDir: firstOut });
    expect(result.status, result.stderr).toBe(0);
  });

  it('writes the product’s own records, chained, in Event Schema v1', () => {
    const records = verdictRecords(firstOut);
    expect(records.length).toBeGreaterThan(0);
    records.forEach((record, i) => {
      expect(record.schemaVersion).toBe(1);
      expect(record.seq).toBe(i);
      expect(record.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof record.timestamp).toBe('string');
    });
  });

  it('stamps every timestamp from the virtual clock, never the wall clock', () => {
    const records = verdictRecords(firstOut);
    for (const record of records) {
      const at = Date.parse(record.timestamp);
      expect(at).toBeGreaterThanOrEqual(EPOCH_MS);
      expect(at).toBeLessThanOrEqual(EPOCH_MS + 31_010);
    }
  });

  it('reaches the attribution states and evidence codes the trace was built for', () => {
    const records = verdictRecords(firstOut);
    const evidence = new Set();
    const statuses = new Set();
    for (const record of records) {
      if (!record.attribution) continue;
      statuses.add(record.attribution.status);
      for (const code of record.attribution.evidence || []) evidence.add(code);
    }
    // Three-state, and nothing else: no score, no number, no fourth verdict.
    expect([...statuses].sort()).toEqual(['confirmed', 'inferred', 'unattributed']);
    expect(evidence).toContain('self-config-path');
    expect(evidence).toContain('cwd-containment');
    expect(evidence).toContain('no-owner-match');
    expect(evidence).toContain('population-unavailable');
    expect(evidence).toContain('handle-scan-pid');
    expect(evidence).toContain('os-tcp-owner-pid');
  });

  it('keeps an unattributed event ownerless, rather than blaming a substitute', () => {
    const records = verdictRecords(firstOut);
    for (const record of records) {
      if (record.attribution && record.attribution.status === 'unattributed') {
        expect(record.agent).toBe('');
        expect(record.instanceId).toBeNull();
      }
    }
  });

  it('carries the RECORDED path, not this machine’s', () => {
    // Paths are neutralized when a trace is written, so a verdict names the recording's
    // tree. It is what lets a verdict be committed as a golden, and it is why the case
    // below has to look up its records through the same transform.
    const records = verdictRecords(firstOut);
    const withPaths = records.filter((r) => r.path);
    expect(withPaths.length).toBeGreaterThan(0);
    for (const record of withPaths) {
      expect(record.path).toBe(paths.neutralizePath(record.path));
    }
  });

  it('exempts an agent reading its own config, and flags the secret next to it', () => {
    const records = verdictRecords(firstOut);
    const recorded = (p) => paths.neutralizePath(p);
    const own = records.find(
      (r) => r.path === recorded(path.join(projDir, '.claude', 'settings.json')),
    );
    const secret = records.find((r) => r.path === recorded(path.join(projDir, '.env')));
    expect(own, 'the self-config event reached the audit log').toBeDefined();
    expect(secret, 'the secret event reached the audit log').toBeDefined();
    expect(own.severity, 'self-access clears the sensitive flag').toBe('normal');
    expect(own.attribution.evidence).toContain('self-config-path');
    expect(secret.severity, 'the same agent reading .env is still sensitive').toBe('sensitive');
    expect(secret.attribution.status).toBe('inferred');
  });
});

describe('replay-trace — determinism', () => {
  it('two runs of the same trace produce byte-identical verdicts', () => {
    // This is the phase's whole claim, and it is checked on the bytes rather than on a
    // parse: a comparison of parsed objects would forgive a reordering or a formatting
    // change that a downstream diff of two sensor versions would not.
    const outA = path.join(scratch, 'det-a');
    const outB = path.join(scratch, 'det-b');
    expect(runReplay({ outDir: outA }).status).toBe(0);
    expect(runReplay({ outDir: outB }).status).toBe(0);
    const a = fs.readFileSync(path.join(outA, replayTrace.VERDICT_FILENAME));
    const b = fs.readFileSync(path.join(outB, replayTrace.VERDICT_FILENAME));
    expect(a.length).toBeGreaterThan(0);
    expect(b.equals(a)).toBe(true);
  });

  it('a changed trace produces a changed verdict', () => {
    // Without this, byte equality above would be satisfied by a harness that ignored
    // its input entirely.
    const other = path.join(scratch, 'trace-b');
    const trace = 'T0-harness-mechanism';
    const agent = {
      agent: 'Claude Code',
      pid: 4812,
      process: 'claude.exe',
      instanceId: `4812:${EPOCH_MS}`,
      cwd: projDir,
      category: 'ai',
      parentEditor: null,
    };
    const records = writer.chainRecords([
      writer.buildRecord({
        trace,
        seq: 0,
        kind: 'population.set',
        epochMs: EPOCH_MS,
        input: { agents: [agent] },
      }),
      writer.buildRecord({
        trace,
        seq: 1,
        kind: 'fs.event',
        epochMs: EPOCH_MS + 10,
        input: { action: 'created', path: path.join(projDir, 'different.env') },
        ambient: { populationReliable: true, isOtherPanelExpanded: false },
      }),
    ]);
    const env = environment.observeEnvironment({ clockEpochMs: EPOCH_MS });
    const header = writer.buildHeader({
      id: trace,
      clockEpochMs: EPOCH_MS,
      env,
      settings: {},
      scope: {
        processTicks: { value: null, unavailable: 'scan-loop.doProcessScan is not exported' },
        anomalyAlerts: { value: null, unavailable: 'out-of-scope-phase-1' },
        rmFullPath: { value: null, unavailable: 'the getSensitiveHolders injection is one-way' },
      },
    });
    writer.writeTrace(other, header, records);

    const outC = path.join(scratch, 'det-c');
    expect(runReplay({ outDir: outC, traceDir: other }).status).toBe(0);
    const changed = fs.readFileSync(path.join(outC, replayTrace.VERDICT_FILENAME));
    const original = fs.readFileSync(path.join(scratch, 'det-a', replayTrace.VERDICT_FILENAME));
    expect(changed.equals(original)).toBe(false);
  });
});
