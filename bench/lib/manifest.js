/**
 * @file bench/lib/manifest.js
 * @module bench/lib/manifest
 * @description Environment snapshot for one bench run.
 *
 *   A bench number is worth nothing without the machine it was measured on, so
 *   every run directory opens with a manifest. The rule this file is built
 *   around: **an absent fact is recorded as absent, never guessed.** Every
 *   entry is `{value, source}` when the probe succeeded and
 *   `{value: null, unavailable: <reason>, source}` when it did not — so a
 *   reader can tell "this machine reported build 26200" from "we could not
 *   read the build", which a bare `null` or a plausible default would merge.
 *
 *   Nothing here is imported from `src/`. The bench observes the sensor from
 *   outside; a shared module would make AEGIS a contributor to its own
 *   measurement record.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.11.0
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** @type {string} Repository root — this file is `bench/lib/`, two levels down. */
const ROOT = path.resolve(__dirname, '..', '..');

/** @type {number} Manifest shape version. Bump when a field changes meaning. */
const MANIFEST_SCHEMA_VERSION = 1;

/**
 * The three run separations of RESEARCH-BASELINE section 10. Kept here rather
 * than in the CLI so every consumer of a manifest reads the same closed set.
 * @type {ReadonlyArray<string>}
 */
const ARMS = Object.freeze(['A', 'B', 'C']);

/**
 * What each arm runs. Written into the manifest so a run directory explains
 * itself without the reader holding the canon open.
 * @type {Readonly<Object<string, string>>}
 */
const ARM_DESCRIPTIONS = Object.freeze({
  A: 'sensor + Sysmon — coverage and latency',
  B: 'Sysmon + Procmon without the sensor — oracle calibration',
  C: 'sensor alone — overhead',
});

/**
 * Run one environment probe and wrap the outcome so absence stays visible.
 * @param {string} source - How the value was obtained, verbatim (a command
 *   line, a registry key, a Node API). Recorded whether or not the probe won.
 * @param {function(): *} fn - The probe. Returning `null`/`undefined` counts as
 *   an absent fact, not as a value.
 * @returns {{value: *, source: string, unavailable?: string}}
 */
function probe(source, fn) {
  try {
    const value = fn();
    if (value === undefined || value === null) {
      return { value: null, source, unavailable: 'probe produced no value' };
    }
    return { value, source };
  } catch (err) {
    return { value: null, source, unavailable: String((err && err.message) || err) };
  }
}

/**
 * Read named values out of one registry key with a single `reg query`.
 *
 * `reg query` separates name, type and data with runs of four spaces, and the
 * data may itself contain spaces (`Windows 10 Home`) — hence the greedy tail.
 * A name that is not in the output is simply absent from the result: the
 * caller decides what that means, and no default is substituted here.
 * @param {string} keyPath - e.g. `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion`
 * @param {string[]} names - Value names to keep.
 * @returns {Object<string, string|number>} REG_DWORD parsed as a number (the
 *   data is printed in hex), every other type kept as a trimmed string.
 */
function readRegistryValues(keyPath, names) {
  const out = execFileSync('reg', ['query', keyPath], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const wanted = new Set(names);
  /** @type {Object<string, string|number>} */
  const found = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s{4}(\S+)\s{4}(REG_\w+)\s{4}(.*)$/);
    if (!m) continue;
    const [, name, type, raw] = m;
    if (!wanted.has(name)) continue;
    found[name] = type === 'REG_DWORD' ? Number.parseInt(raw, 16) : raw.trim();
  }
  return found;
}

/**
 * Run a git command in the repository root and return its trimmed stdout.
 * @param {string[]} args
 * @returns {string}
 */
function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

/**
 * Windows build identity, from the registry rather than `os.release()`.
 *
 * `os.release()` gives `10.0.26200` and stops there; the UBR — the fourth
 * component that actually distinguishes two machines both calling themselves
 * 26200 — exists only in the registry. `productName` is recorded verbatim even
 * when it disagrees with `os.version()` (Windows 11 machines routinely report
 * `Windows 10 <edition>` under this key): the manifest records what each
 * source said, and never reconciles two sources into one invented answer.
 * @returns {{value: Object|null, source: string, unavailable?: string}}
 */
function windowsBuild() {
  const key = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';
  return probe(`reg query "${key}"`, () => {
    if (process.platform !== 'win32') return null;
    const v = readRegistryValues(key, ['CurrentBuild', 'UBR', 'DisplayVersion', 'ProductName']);
    if (Object.keys(v).length === 0) return null;
    return {
      currentBuild: v.CurrentBuild ?? null,
      ubr: v.UBR ?? null,
      displayVersion: v.DisplayVersion ?? null,
      productName: v.ProductName ?? null,
    };
  });
}

/**
 * How many processes were on the machine when the run started.
 *
 * `tasklist` is the same enumerator `process-scanner.js` uses, but it is
 * spawned here directly rather than imported: the count is context for reading
 * the numbers (provider cost scales with it — see
 * docs/bench/generation-v2-2026-08-12.md), not evidence about the sensor, and
 * the bench must not depend on the module under measurement.
 * @returns {{value: number|null, source: string, unavailable?: string}}
 */
function processCount() {
  return probe('tasklist /FO CSV /NH', () => {
    if (process.platform !== 'win32') return null;
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return out.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
  });
}

/**
 * Placeholder oracle block. B2.3 fills `sysmon`, B2.6 fills `procmon` — each
 * with a version, the config path and that config's SHA-256, so a run can be
 * re-created. Until then the fields are present and explicitly null, because a
 * key that is simply missing reads as "we forgot" rather than "not yet wired".
 * @returns {Object}
 */
function oraclePlaceholders() {
  return {
    sysmon: {
      version: null,
      configPath: null,
      configSha256: null,
      unavailable: 'oracle adapter not implemented — arrives in sub-block B2.3',
    },
    procmon: {
      version: null,
      configPath: null,
      configSha256: null,
      unavailable: 'oracle adapter not implemented — arrives in sub-block B2.6',
    },
  };
}

/**
 * Collect the manifest for one run.
 * @param {Object} opts
 * @param {string} opts.runId - Directory name of the run.
 * @param {string} opts.scenario - Scenario id, or the no-scenario placeholder.
 * @param {string} opts.arm - One of {@link ARMS}.
 * @param {string} opts.startedAt - UTC ISO timestamp of the run start.
 * @param {Object} [opts.reportRenderer] - `bench/lib/report.js`'s
 *   `RENDERER_FINGERPRINT`: which report-renderer source bytes this process is
 *   running. Handed in rather than taken here, so the manifest records the
 *   renderer the run LOADED and not the file as it stood when this snapshot was
 *   collected — the two differ whenever the tree is edited mid-run, which
 *   `sensor.workingTreeDirty` says is a state this harness expects. A caller
 *   that supplies none leaves the field null, and a null reads as
 *   `legacy-unversioned` downstream: no fingerprint is ever reconstructed for a
 *   run that recorded none.
 * @returns {Object} The manifest, ready to serialize.
 */
function collect(opts) {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    runId: opts.runId,
    scenario: opts.scenario,
    arm: opts.arm,
    armDescription: ARM_DESCRIPTIONS[opts.arm] ?? null,
    startedAt: opts.startedAt,
    host: {
      platform: probe('process.platform', () => process.platform),
      osRelease: probe('os.release()', () => os.release()),
      osVersion: probe('os.version()', () => os.version()),
      windowsBuild: windowsBuild(),
      cpuModel: probe('os.cpus()[0].model', () => os.cpus()[0].model),
      cpuCount: probe('os.cpus().length', () => os.cpus().length),
      totalMemBytes: probe('os.totalmem()', () => os.totalmem()),
      uptimeSec: probe('os.uptime()', () => Math.round(os.uptime())),
      nodeVersion: probe('process.version', () => process.version),
    },
    sensor: {
      packageVersion: probe('package.json version', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        return pkg.version;
      }),
      gitSha: probe('git rev-parse HEAD', () => git(['rev-parse', 'HEAD'])),
      gitBranch: probe('git rev-parse --abbrev-ref HEAD', () =>
        git(['rev-parse', '--abbrev-ref', 'HEAD']),
      ),
      // A dirty tree means the measured sensor is not the commit named above.
      // Recorded, not refused: a run against uncommitted work is legitimate
      // while building the harness, and dishonest only if left unsaid.
      workingTreeDirty: probe(
        'git status --porcelain',
        () => git(['status', '--porcelain']).length > 0,
      ),
    },
    // Which source bytes rendered this run's report. Not a `{value, source}`
    // probe: it is not a fact about this machine but the identity of the code
    // that will write run-report.json, and `gitSha` above cannot stand in for
    // it — a dirty tree names a commit the renderer is not.
    reportRenderer: opts.reportRenderer ?? null,
    processCountAtStart: processCount(),
    oracles: oraclePlaceholders(),
  };
}

module.exports = {
  ARMS,
  ARM_DESCRIPTIONS,
  MANIFEST_SCHEMA_VERSION,
  ROOT,
  collect,
  probe,
  readRegistryValues,
};
