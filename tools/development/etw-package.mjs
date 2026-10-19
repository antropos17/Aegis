import fs from 'node:fs';
import path from 'node:path';
import { matchingRead } from '../../frontend/observatory/tests/etw-support.mjs';

/** Publish the existing pinned helper as a self-contained folder for one diagnostic build.
 * Normal Windows packaging publishes the same helper through its build hook. No single-file extraction
 * or globally installed .NET runtime is needed by the elevated collector.
 * @param {string} root Source checkout. @param {string} output Private qualification output.
 * @param {Function} command Bounded command runner.
 * @returns {Promise<string>} Private electron-builder config path. @since v0.19.2
 */
export async function prepareEtwPackage(root, output, command) {
  const publish = path.join(output, 'etw-file');
  await command(
    'etw-publish',
    'dotnet',
    [
      'publish',
      path.join(root, 'sidecar/etw-file/EtwFile.csproj'),
      '-c',
      'Release',
      '-r',
      'win-x64',
      '--self-contained',
      'true',
      '-p:PublishSingleFile=false',
      '-o',
      publish,
      '--nologo',
    ],
    240000,
  );
  for (const name of ['EtwFile.exe', 'EtwFile.dll', 'coreclr.dll', 'EtwFile.runtimeconfig.json'])
    if (!fs.statSync(path.join(publish, name)).isFile()) throw new Error('Incomplete ETW publish');
  await command('etw-published-self-test', path.join(publish, 'EtwFile.exe'), ['self-test'], 30000);
  const config = structuredClone(
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).build,
  );
  config.extraMetadata = { ...config.extraMetadata, aegisEtwDiagnostic: true };
  config.win.extraResources = [
    ...(config.win.extraResources ?? []).filter((entry) => entry?.to !== 'etw-file'),
    { from: publish, to: 'etw-file', filter: ['**/*', '!**/*.pdb'] },
  ];
  const file = path.join(output, 'etw-builder.json');
  fs.writeFileSync(file, JSON.stringify(config, null, 2), { flag: 'wx' });
  return file;
}

/** Require live diagnostic candidates, honest UI health and acknowledged quit.
 * Losses remain measured values and cannot promote this result into production admission.
 * @param {object} r Private package receipt. @returns {boolean} @since v0.19.2
 */
export function etwPassed(r) {
  const s = r?.summary,
    c = s?.finalCounters,
    t = s?.finalTotals;
  const decimal = (value) => typeof value === 'string' && /^\d+$/.test(value);
  return (
    r?.status === 'PASS' &&
    [
      'packaged',
      'diagnosticBuild',
      'bundleSelfContained',
      'windowInputIsolated',
      'liveReady',
      'readCandidate',
      'candidateMetadataOnly',
      'scopeExcluded',
      'ringBounded',
      'populationReliable',
      'healthVisible',
      'quitDuringCapture',
      'closureConfirmed',
      'contentExcluded',
      'noDiagnosticAudit',
    ].every((key) => r[key] === true) &&
    !r.appCleanupUnconfirmed &&
    r.productionAdmission === false &&
    r.health?.state === 'DEGRADED' &&
    r.health.detail?.includes('experimental-correlation') &&
    s?.stopVerified === true &&
    s.phase === 'stopped' &&
    s.exitCode === 0 &&
    s.stopReason === 'shutdown' &&
    c?.queryStatus === 0 &&
    ['eventsLost', 'realTimeBuffersLost', 'logBuffersLost'].every((key) => decimal(c[key])) &&
    typeof t === 'object' &&
    t !== null &&
    [
      'dropped',
      'ingressDropped',
      'outputDropped',
      'outputOverflowDropped',
      'outputInvalidatedDropped',
    ].every((key) => decimal(t[key])) &&
    BigInt(t.ingressDropped) + BigInt(t.outputDropped) === BigInt(t.dropped) &&
    BigInt(t.outputOverflowDropped) + BigInt(t.outputInvalidatedDropped) === BigInt(t.outputDropped)
  );
}

/** Require actual pending I/O, full issuer witnesses, crash cleanup and a fresh capture.
 * @param {object} r Root private two-capture receipt. @returns {boolean} @since v0.19.2
 */
export function etwRecoveryPassed(r) {
  const crash = r?.crash,
    normal = r?.normal,
    summary = crash?.summary;
  const proof = (scenario, mode) => {
    const p = scenario?.[mode + 'Proof'];
    return (
      p &&
      p.native?.reads === 160 &&
      (mode !== 'async' || p.native.pending > 0) &&
      matchingRead([p.record], p.native) !== undefined
    );
  };
  return Boolean(
    r?.status === 'PASS' &&
    r.productionAdmission === false &&
    r.newSessionAfterRecovery === true &&
    etwPassed(normal) &&
    crash?.status === 'PASS' &&
    crash.closureConfirmed === true &&
    crash.failureVisible === true &&
    crash.guardClosureConfirmed === true &&
    crash.noAutomaticRestart === true &&
    crash.rapidExitNoWrongGeneration === true &&
    crash.rapidExitUnresolved === true &&
    crash.rapidExitObserved > 0 &&
    summary?.recoveryVerified === true &&
    summary.stopVerified === false &&
    summary.exitCode === 4 &&
    summary.collectorExit === 70 &&
    summary.finalTotals === null &&
    summary.observationGap === true &&
    ['sync', 'async'].every((mode) => proof(crash, mode) && proof(normal, mode)),
  );
}
