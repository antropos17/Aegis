import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { exitWithin } from './sensor-support.mjs';

/** @param {number} ms @returns {Promise<void>} @since v0.19.2 */
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read the actual main owner; no backend/record injection or preload addition.
 * @param {object} app @returns {Promise<object>} @since v0.19.2
 */
export function diagnostics(app) {
  return app.evaluate(({ app }) =>
    process.mainModule
      .require('node:module')
      .createRequire(app.getAppPath() + '/package.json')('./src/main/main.js')
      .getEtwFileDiagnostics(),
  );
}

/** Start a normal-token native fixture with capped metadata-only output.
 * @param {string} executable @param {string} file @param {object} env @param {boolean} short
 * @returns {object} Owned process and finite command interface. @since v0.19.2
 */
export function readFixture(executable, file, env, short = false) {
  const child = spawn(executable, [file, ...(short ? ['short'] : [])], {
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.on('error', () => {});
  const lines = [];
  let bytes = 0;
  createInterface({ input: child.stdout }).on('line', (line) => {
    bytes += Buffer.byteLength(line);
    if (bytes <= 16384 && lines.length < 8) lines.push(line);
  });
  child.stderr.on('data', (data) => {
    bytes += data.length;
  });
  const next = async () => {
    const until = Date.now() + 12000;
    while (!lines.length && !child.stdout.readableEnded && Date.now() < until) await delay(20);
    assert(bytes <= 16384 && lines.length, 'Read fixture unavailable or output budget exceeded');
    return JSON.parse(lines.shift());
  };
  return {
    child,
    next,
    async command(mode) {
      child.stdin.write(mode + '\n');
      return next();
    },
    async close() {
      child.stdin.end();
      assert.equal(await exitWithin(child), 0);
    },
  };
}

/** Observe bounded real records while fixture commands are in flight.
 * @param {object} app @param {number} pid @param {string} root @param {string} canary
 * @returns {object} Live sampled proof, errors and drain method. @since v0.19.2
 */
export function observe(app, pid, root, canary) {
  const probe = {
    records: [],
    omitted: 0,
    ringBounded: true,
    scopeExcluded: true,
    contentExcluded: true,
    error: null,
  };
  let stopping = false;
  const worker = (async () => {
    try {
      while (!stopping) {
        const data = await diagnostics(app);
        assert(
          data.ringBytes <= 1024 ** 2 && data.records.length <= 256,
          'Diagnostic ring exceeded cap',
        );
        assert(!JSON.stringify(data).includes(canary), 'File contents entered diagnostics');
        assert(
          data.records.every(
            (r) => r.path === null || r.path.toLowerCase().startsWith(root.toLowerCase() + '\\'),
          ),
          'Outside-root path retained',
        );
        for (const r of data.records.filter((r) => r.issuerPid === pid && r.agent === 'Aider')) {
          if (probe.records.some((existing) => existing.eventSeq === r.eventSeq)) continue;
          if (probe.records.length === 128) {
            probe.records.shift();
            probe.omitted++;
          }
          probe.records.push(r);
        }
        await delay(100);
      }
    } catch (error) {
      probe.error = error.message;
    }
  })();
  return {
    probe,
    async close() {
      stopping = true;
      await worker;
      assert.equal(probe.error, null);
    },
  };
}

/** Compare a live read with independent native QPC/PID/TID/full FILETIME witnesses.
 * @param {object[]} records @param {object} native @returns {object|undefined} @since v0.19.2
 */
export function matchingRead(records, native) {
  const decimal = (v) =>
    typeof v === 'string' && /^(0|[1-9]\d{0,19})$/.test(v) && BigInt(v) <= 0xffffffffffffffffn;
  if (
    !native ||
    ![native.birth, native.fromQpc, native.toQpc].every(decimal) ||
    !Array.isArray(records)
  )
    return undefined;
  const instance = `${native.pid}:${(BigInt(native.birth) - 116444736000000000n) / 10000n}`;
  return records.find(
    (r) =>
      r?.eventId === 15 &&
      r.version === 1 &&
      r.provider === 'edd08927-9cc4-4e65-b970-c2560fb5c289' &&
      [
        r.qpc,
        r.issuerInterval?.fromQpc,
        r.issuerInterval?.toQpc,
        r.generationInterval?.fromQpc,
        r.generationInterval?.toQpc,
      ].every(decimal) &&
      BigInt(r.issuerInterval.fromQpc) < BigInt(r.qpc) &&
      BigInt(r.qpc) <= BigInt(r.generationInterval.fromQpc) &&
      BigInt(r.generationInterval.fromQpc) <= BigInt(r.generationInterval.toQpc) &&
      BigInt(r.generationInterval.toQpc) <= BigInt(r.issuerInterval.toQpc) &&
      r.generationSource === 'createTime100ns' &&
      r.issuerStatus === 'verified' &&
      r.generationStatus === 'verified' &&
      r.issuerPid === native.pid &&
      r.issuingTid === native.tid &&
      r.generationWitness === native.birth &&
      r.instanceId === instance &&
      r.agent === 'Aider' &&
      BigInt(r.qpc) >= BigInt(native.fromQpc) &&
      BigInt(r.qpc) <= BigInt(native.toQpc),
  );
}

/** Save a read-only final snapshot immediately before the real application exits.
 * @param {object} app @param {string} destination @returns {Promise<void>} @since v0.19.2
 */
export function observeQuit(app, destination) {
  return app.evaluate(({ app }, file) => {
    const require = process.mainModule
      .require('node:module')
      .createRequire(app.getAppPath() + '/package.json');
    const main = require('./src/main/main.js');
    app.once('will-quit', () => {
      const data = JSON.stringify(main.getEtwFileDiagnostics());
      require('node:fs').writeFileSync(file, data.length <= 262144 ? data : '{"overflow":true}', {
        flag: 'wx',
      });
    });
  }, destination);
}

/** Create a fresh private scenario tree and synthetic canary fixture.
 * @param {string} out @param {string} canary @returns {object} @since v0.19.2
 */
export function scenarioPaths(out, canary) {
  fs.mkdirSync(out);
  for (const dir of ['fixture', 'home', 'temp']) fs.mkdirSync(path.join(out, dir));
  const file = path.join(out, 'fixture/read.txt');
  fs.writeFileSync(file, canary.padEnd(4096, '.'));
  return {
    fixture: path.dirname(file),
    file,
    profile: path.join(out, 'profile'),
    home: path.join(out, 'home'),
    temp: path.join(out, 'temp'),
  };
}

/** Observe descendants of the retained app roots, including elevated collector/guard.
 * These PIDs are existence witnesses only; no intervention uses them.
 * @param {number[]} roots @param {object} env @param {number[]} nativeIds Original custody IDs.
 * @returns {number[]} @since v0.19.2
 */
export function traceHelpers(roots, env, nativeIds = []) {
  assert(nativeIds.length <= 4 && nativeIds.every((pid) => Number.isSafeInteger(pid) && pid > 0));
  let parents = [...new Set([...roots, ...nativeIds])];
  const helpers = [...nativeIds];
  for (let depth = 0; depth < 4 && parents.length; depth++) {
    assert(parents.every((pid) => Number.isInteger(pid) && pid > 0));
    const filter = parents.map((pid) => `ParentProcessId = ${pid}`).join(' OR ');
    const text = execFileSync(
      path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `@(Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object ProcessId,Name) | ConvertTo-Json -Compress`,
      ],
      { env, windowsHide: true, timeout: 10000, maxBuffer: 65536 },
    )
      .toString()
      .trim();
    const rows = [JSON.parse(text || '[]')].flat();
    helpers.push(
      ...rows.filter((r) => r.Name?.toLowerCase() === 'etwfile.exe').map((r) => r.ProcessId),
    );
    parents = rows.map((r) => r.ProcessId);
  }
  return [...new Set(helpers)];
}

/** Query existence without opening elevated processes for termination rights.
 * Signal-zero on Windows can report EPERM for exited elevated process objects.
 * @param {number[]} pids Owned metadata-only IDs. @param {object} env Child environment.
 * @returns {number[]} Currently enumerated IDs; errors remain errors. @since v0.19.2
 */
export function remainingPids(pids, env) {
  assert(
    pids.length > 0 && pids.length <= 100 && pids.every((pid) => Number.isInteger(pid) && pid > 0),
  );
  const filter = [...new Set(pids)].map((pid) => `ProcessId = ${pid}`).join(' OR ');
  const raw = execFileSync(
    path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`,
    ],
    { env, windowsHide: true, timeout: 10000, maxBuffer: 16384 },
  )
    .toString()
    .trim();
  const result = [JSON.parse(raw || '[]')].flat();
  assert(result.every((pid) => pids.includes(pid)));
  return result;
}
