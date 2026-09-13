// Explicit local process check. --live additionally requests real UAC and ETW.
// No raw observations or filesystem paths are written into the report.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supervisor from '../src/main/platform/etw-file-supervisor.js';
import protocol from '../src/main/platform/etw-file-protocol.js';
import { runFileLoad } from './etw-file-load.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(root, 'sidecar/etw-file/bin/Release/net10.0-windows/EtwFile.exe');
const live = process.argv.includes('--live');
const lossCheck = process.argv.includes('--loss-check');
const loadCheck = process.argv.includes('--load-check');
if (live && lossCheck)
  throw new Error('--loss-check is synthetic and cannot be combined with --live');
if (loadCheck && !live) throw new Error('--load-check requires --live');
const destination = process.argv.find((value) => value.startsWith('--report='))?.slice(9);
if (process.platform !== 'win32' || !destination || fs.existsSync(destination))
  throw new Error('Windows and a new --report=<file> are required');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-etw-file-'));
const file = path.join(fixture, 'fixture.dat');
fs.writeFileSync(file, Buffer.alloc(4096, 7));
const report = {
  schema: 1,
  live,
  synthetic: !live,
  protocol: protocol.PROTOCOL,
  lossCheck,
  loadCheck,
  startedAt: new Date().toISOString(),
  binarySha256: createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
  assemblySha256: createHash('sha256')
    .update(fs.readFileSync(executable.replace(/\.exe$/, '.dll')))
    .digest('hex'),
  cases: [],
  passed: false,
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, ms) {
  const deadline = performance.now() + ms;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error('deadline');
    await delay(25);
  }
}
let broker;
const sensor = supervisor.createSupervisor({
  spawnBroker: (launchId, sessionId) => {
    const mode = live ? 'broker' : lossCheck ? 'check-loss-broker' : 'check-broker';
    broker = spawn(executable, [mode, launchId, sessionId, fixture], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return broker;
  },
});
try {
  // Each retry below is explicit and follows verified cleanup, never an automatic failure retry.
  for (let index = 0; index < (live ? 1 : 2); index++) {
    if (!sensor.start()) throw new Error('start-blocked');
    await until(() => ['running', 'failed'].includes(sensor.getDiagnostics().phase), 135000);
    if (sensor.getDiagnostics().phase !== 'running') throw new Error('start-failed');
    let observed = false,
      named = false,
      fixtureRead = false,
      leaked = false;
    const inspect = () => {
      const diagnostics = sensor.getDiagnostics();
      if (diagnostics.phase !== 'running') throw new Error('capture-not-running');
      const records = diagnostics.records;
      observed ||= records.some((r) => r.eventId === 15);
      named ||= records.some((r) => r.path === file);
      fixtureRead ||= records.some(
        (r) => r.path === file && r.eventId === 15 && r.headerPid === process.pid,
      );
      leaked ||= records.some(
        (r) =>
          r.agent !== null ||
          r.instanceId !== null ||
          (r.path !== null && !r.path.startsWith(fixture + '\\')),
      );
    };
    if (loadCheck) {
      report.load = {};
      await runFileLoad(file, inspect, report.load);
    } else {
      const deadline = performance.now() + (live ? 10000 : 3000);
      while (performance.now() < deadline) {
        if (live) fs.readFileSync(file); // Only this ordinary process reads the fixture.
        inspect();
        if (!live && observed) break;
        await delay(25);
      }
    }
    report.observationCheck = { observed, named, fixtureRead, leaked };
    if (!observed || leaked || (live && !fixtureRead)) throw new Error('observation-contract');
    const before = sensor.getDiagnostics();
    sensor.stop();
    await until(() => sensor.getDiagnostics().summaries.length > index, 20000);
    const result = sensor.getDiagnostics().summaries.at(-1);
    if (!result.stopVerified) throw new Error('stop-unverified');
    if (
      !result.collectorPerformance ||
      !result.mainPerformance ||
      BigInt(result.collectorPerformance.pump.calls) === 0n ||
      BigInt(result.collectorPerformance.outputWrite.calls) === 0n ||
      BigInt(result.collectorPerformance.brokerForward?.duration.calls ?? 0) === 0n ||
      BigInt(result.collectorPerformance.outputFlow?.readyToTake.calls ?? 0) === 0n ||
      !result.collectorPerformance.outputFlow?.windows.length ||
      BigInt(result.mainPerformance.decodeChunk.calls) === 0n
    )
      throw new Error('service-measurements-missing');
    const totals = result.finalTotals;
    if (
      !totals ||
      BigInt(totals.ingressDropped) + BigInt(totals.outputDropped) !== BigInt(totals.dropped) ||
      BigInt(totals.outputOverflowDropped) + BigInt(totals.outputInvalidatedDropped) !==
        BigInt(totals.outputDropped)
    )
      throw new Error('stage-loss-accounting');
    if (
      lossCheck &&
      (totals.ingressDropped !== '4097' || BigInt(totals.outputOverflowDropped) === 0n)
    )
      throw new Error('stage-loss-not-exercised');
    if (
      live &&
      (result.finalCounters?.queryStatus !== 0 ||
        (!loadCheck &&
          ['eventsLost', 'realTimeBuffersLost', 'logBuffersLost'].some(
            (key) => result.finalCounters[key] !== '0',
          )))
    )
      throw new Error('native-loss-or-unmeasured');
    report.cases.push({
      kind: index ? 'explicit-new-session' : 'normal-stop',
      observedRead: observed,
      observedScopedCandidate: named,
      observedFixturePidCandidate: fixtureRead,
      ringBytes: before.ringBytes,
      ringDropped: before.ringDropped,
      sensorState: sensor.getHealth().state,
      summary: result,
    });
  }
  if (!live) {
    if (!sensor.start()) throw new Error('start-blocked');
    await until(() => sensor.getDiagnostics().phase === 'running', 15000);
    broker.stdin.end();
    await until(() => sensor.getDiagnostics().summaries.length === 3, 25000);
    const result = sensor.getDiagnostics().summaries.at(-1);
    if (result.stopVerified || !sensor.getDiagnostics().restartBlocked)
      throw new Error('false-cleanup');
    report.cases.push({ kind: 'parent-eof-unverified', summary: result });
  }
  report.passed = true;
} catch (error) {
  report.error = error.message;
  report.finalHealth = sensor.getHealth();
  process.exitCode = 2;
} finally {
  sensor.dispose();
  if (broker && broker.exitCode === null) {
    try {
      await until(() => broker.exitCode !== null, 35000);
    } catch {
      report.cleanupUnverified = true;
      report.passed = false;
      process.exitCode = 2;
    }
  }
  report.endedSessions = sensor.getDiagnostics().summaries;
  report.endedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(
    JSON.stringify({
      passed: report.passed,
      live,
      cases: report.cases.length,
      error: report.error,
    }),
  );
}
