/**
 * @file scripts/bench-generation.js
 * @description Measure the process-table observation the scan loop pays on every
 *   non-empty enrichment pass, and check that switching provider cannot move an
 *   identity.
 *
 *   Method, mirroring the measurement this block exists to beat (N=32, 486
 *   processes, p50 1284 / p95 1459 / max 1657 ms): one sample is one provider call
 *   measured end to end in JavaScript, from the call to the resolved Map the scan
 *   loop consumes. Nearest-rank percentiles over N samples. The process count is
 *   recorded per sample, because the cost scales with it.
 *
 *   Two refinements over the original, both deliberate:
 *     - the arms are INTERLEAVED round-robin rather than run in blocks, so machine
 *       drift lands on every arm equally;
 *     - every sample records which provider actually served it, and the script
 *       REFUSES to print a comparison if a sidecar arm was served by anything else.
 *       Without that, a wrong binary path would produce a "no speedup" table with no
 *       hint that the sidecar never ran.
 *
 *   Usage:
 *     node scripts/bench-generation.js [--n 32]
 *     node scripts/bench-generation.js --parity
 *
 *   The committed record lives in docs/bench/ and is written by hand from this
 *   output, so the prose around the numbers survives a re-run.
 */
'use strict';

// The chooser reads its rollout flag once, at require time. `strict` removes the CIM
// fallback so a sidecar arm can only ever be a sidecar arm.
process.env.AEGIS_PROC_SNAPSHOT = 'strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const win32 = require(path.join(ROOT, 'src/main/platform/win32.js'));
const snapshot = require(path.join(ROOT, 'src/main/platform/process-snapshot.js'));
const client = require(path.join(ROOT, 'src/main/platform/proc-snapshot-client.js'));
const protocol = require(path.join(ROOT, 'src/main/platform/proc-snapshot-protocol.js'));

const EXE = path.join(ROOT, 'build', 'sidecar', 'aegis-procsnap.exe');

/**
 * @param {number[]} values
 * @param {number} pct - 0..1
 * @returns {number} nearest-rank percentile
 */
function percentile(values, pct) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(pct * sorted.length));
  return sorted[rank - 1];
}

/**
 * @param {number[]} values
 * @returns {{n: number, p50: number, p95: number, max: number, min: number, mean: number}}
 */
function summarise(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    n: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
    min: Math.min(...values),
    mean: Math.round(mean * 10) / 10,
  };
}

/**
 * One cold sidecar run: spawn, handshake, one snapshot, exit. Deliberately does NOT
 * go through proc-snapshot-client — this arm measures the raw startup tax of the
 * binary, not the supervision layer around it.
 * @returns {Promise<{ms: number, procs: number, us: number}>}
 */
function coldSnapshot() {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(EXE, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const decoder = protocol.createFrameDecoder();
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch (_) {
        // already gone
      }
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error('cold snapshot timed out')), 10000);
    child.on('error', fail);
    child.stderr.on('data', (d) => process.stderr.write(`sidecar: ${d}`));
    child.stdout.on('data', (chunk) => {
      const { frames, errors, fatal } = decoder.push(chunk);
      if (fatal || errors.length) return fail(new Error(errors.join('; ') || 'desynchronised'));
      for (const frame of frames) {
        if (frame.t === 'hello') child.stdin.write(protocol.encodeFrame({ t: 'snap', id: 1 }));
        else if (frame.t === 'snap') {
          const ms = performance.now() - started;
          settled = true;
          clearTimeout(timer);
          child.stdin.end();
          resolve({ ms, procs: frame.procs.length, us: frame.us || 0 });
        } else fail(new Error(`unexpected frame ${frame.t}`));
      }
    });
  });
}

/** @returns {Promise<{ms: number, procs: number, source: string}>} */
async function armCim() {
  const started = performance.now();
  const map = await win32.cimParentProcessMap();
  return { ms: performance.now() - started, procs: map.size, source: 'cim' };
}

/** @returns {Promise<{ms: number, procs: number, source: string}>} */
async function armSidecarWarm() {
  const started = performance.now();
  const map = await snapshot.getParentProcessMap();
  const ms = performance.now() - started;
  return { ms, procs: map.size, source: snapshot.getSourceStats().lastSource };
}

/** @returns {Promise<{ms: number, procs: number, source: string}>} */
async function armSidecarCold() {
  const res = await coldSnapshot();
  return { ms: res.ms, procs: res.procs, source: 'class5-cold' };
}

const ARMS = [
  { key: 'cim', label: 'CIM (Win32_Process, PowerShell)', run: armCim, expect: 'cim' },
  { key: 'warm', label: 'sidecar warm (live child)', run: armSidecarWarm, expect: 'class5' },
  { key: 'cold', label: 'sidecar cold (spawn + exit)', run: armSidecarCold, expect: 'class5-cold' },
];

/**
 * @param {number} n
 * @returns {Promise<{samples: Array<Object>, byArm: Object, honest: boolean, notes: string[]}>}
 */
async function runBenchmark(n) {
  const samples = [];
  const notes = [];
  let honest = true;
  for (let i = 0; i < n; i++) {
    for (const arm of ARMS) {
      const result = await arm.run();
      samples.push({ i, arm: arm.key, ...result });
      if (result.source !== arm.expect) {
        honest = false;
        notes.push(
          `arm ${arm.key} sample ${i} was served by "${result.source}", not "${arm.expect}"`,
        );
      }
      const line = `  ${i + 1}/${n} ${arm.key.padEnd(5)} ${result.ms.toFixed(1)} ms`;
      // Overwrite in place on a terminal; one line per sample when the output is
      // being captured, so a recorded run stays readable.
      process.stdout.write(process.stdout.isTTY ? `\r${line}      ` : `${line}\n`);
    }
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  const byArm = {};
  for (const arm of ARMS) {
    const values = samples.filter((s) => s.arm === arm.key).map((s) => s.ms);
    byArm[arm.key] = summarise(values);
    byArm[arm.key].procs = samples.filter((s) => s.arm === arm.key)[0].procs;
  }
  return { samples, byArm, honest, notes };
}

/**
 * Do the two providers agree, to the millisecond, about when each process started?
 *
 * They have to. `instanceId` is `pid:startTime(ms)`, so a provider switch that moved
 * a birth time by even one millisecond would split a session and a token ledger
 * mid-run. A mismatch here is a blocking finding, not a rounding note.
 * @returns {Promise<Object>}
 */
async function runParity() {
  const [sidecarMap, cimMap] = await Promise.all([
    snapshot.getParentProcessMap(),
    win32.cimParentProcessMap(),
  ]);
  const compared = [];
  const mismatches = [];
  let oldest = Number.MAX_SAFE_INTEGER;
  for (const [pid, entry] of sidecarMap) {
    const cim = cimMap.get(pid);
    if (!cim || typeof cim.startTime !== 'number' || typeof entry.startTime !== 'number') continue;
    compared.push(pid);
    if (entry.startTime < oldest) oldest = entry.startTime;
    if (entry.startTime !== cim.startTime) {
      mismatches.push({
        pid,
        name: entry.name,
        sidecarMs: entry.startTime,
        cimMs: cim.startTime,
        deltaMs: entry.startTime - cim.startTime,
      });
    }
  }
  return {
    sidecarProcs: sidecarMap.size,
    cimProcs: cimMap.size,
    compared: compared.length,
    exact: compared.length - mismatches.length,
    mismatches,
    oldestProcessAgeHours: Math.round(((Date.now() - oldest) / 3600000) * 10) / 10,
  };
}

/** @returns {string} one line describing the machine the numbers came from. */
function environmentLine() {
  const cpus = os.cpus();
  return [
    `${os.type()} ${os.release()}`,
    `${cpus.length}x ${cpus[0] ? cpus[0].model.trim() : 'unknown cpu'}`,
    `node ${process.version}`,
    `uptime ${Math.round(os.uptime() / 3600)} h`,
  ].join(' | ');
}

function formatTable(byArm) {
  const rows = [
    '| arm | N | procs | p50 ms | p95 ms | max ms | min ms | mean ms |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const arm of ARMS) {
    const s = byArm[arm.key];
    rows.push(
      `| ${arm.label} | ${s.n} | ${s.procs} | ${s.p50.toFixed(1)} | ${s.p95.toFixed(1)} | ` +
        `${s.max.toFixed(1)} | ${s.min.toFixed(1)} | ${s.mean.toFixed(1)} |`,
    );
  }
  return rows.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (!fs.existsSync(EXE)) {
    console.error(`no sidecar binary at ${EXE} — run: npm run build:sidecar`);
    process.exit(1);
  }
  if (args.includes('--parity')) {
    const parity = await runParity();
    console.log(JSON.stringify(parity, null, 2));
    client.shutdown();
    process.exit(parity.mismatches.length === 0 ? 0 : 1);
  }

  const nIndex = args.indexOf('--n');
  const n = nIndex >= 0 ? parseInt(args[nIndex + 1], 10) : 32;
  const rawPath = path.join(os.tmpdir(), `aegis-bench-generation-${Date.now()}.ndjson`);

  console.log(`Generation v2 benchmark — N=${n}, arms interleaved`);
  console.log(`  ${environmentLine()}`);
  const { samples, byArm, honest, notes } = await runBenchmark(n);
  fs.writeFileSync(rawPath, samples.map((s) => JSON.stringify(s)).join('\n'));

  console.log('');
  console.log(formatTable(byArm));
  console.log('');
  if (!honest) {
    console.error('MEASUREMENT REJECTED — an arm was not served by the provider it names:');
    for (const note of notes) console.error(`  ${note}`);
    process.exit(1);
  }
  const speedup = byArm.cim.p50 / byArm.warm.p50;
  console.log(`p50 speedup, warm sidecar vs CIM: ${speedup.toFixed(0)}x`);
  console.log(`raw samples: ${rawPath}`);
  client.shutdown();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
