/** Synthetic acceptance-oracle fixture. @returns {object} Fresh receipt. @since v0.19.2 */
export function receipt() {
  return {
    status: 'PASS',
    productionAdmission: false,
    ...Object.fromEntries(
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
      ].map((key) => [key, true]),
    ),
    health: { state: 'DEGRADED', detail: 'experimental-correlation' },
    summary: {
      stopVerified: true,
      phase: 'stopped',
      exitCode: 0,
      stopReason: 'shutdown',
      finalCounters: {
        queryStatus: 0,
        eventsLost: '0',
        realTimeBuffersLost: '0',
        logBuffersLost: '0',
      },
      finalTotals: {
        dropped: '7',
        ingressDropped: '5',
        outputDropped: '2',
        outputOverflowDropped: '1',
        outputInvalidatedDropped: '1',
      },
    },
  };
}

/** Synthetic twenty-two-case fixture; never live qualification evidence.
 * @returns {object} Fresh receipt. @since v0.19.2
 */
export function groupReceipt() {
  const r = totalReceipt();
  for (const mode of [
    'group-before-start',
    'group-before-arm',
    'group-broker-first',
    'group-triple-first',
    'group-access-denied',
  ]) {
    const c = structuredClone(r.cases['triple-before-arm']);
    c.mode = mode;
    c.mainSurvived = true;
    c.mainCustodyObserved = true;
    c.cleanupConsentPendingObserved = mode === 'group-access-denied';
    c.liveReady = !mode.includes('-before-');
    c.summary.capture = c.liveReady ? { buffers: { count: 256, sizeKiB: 64 } } : null;
    c.summary.brokerExit = 75;
    c.summary.recoveryCause = 'broker-and-all-helpers-exited';
    c.summary.finalCounters.queryStatus = mode.endsWith('before-start') ? 4201 : 0;
    c.summary.recoveryPeers.cleanupElevated = mode === 'group-access-denied';
    c.summary.recoveryPeers.accessDenied = mode === 'group-access-denied';
    r.cases[mode] = c;
  }
  const broker = r.cases['broker-exit'];
  Object.assign(broker, { mainSurvived: true, mainCustodyObserved: true, restartBlocked: false });
  Object.assign(broker.summary, {
    phase: 'recovered',
    recoveryCause: 'broker-and-all-helpers-exited',
    brokerExit: 72,
    collectorExit: 2,
    exitCode: 4,
    recoveryVerified: true,
    stopVerified: false,
    finalCounters: { queryStatus: 4201 },
    recoveryPeers: {
      guardExit: 0,
      fallbackExit: 0,
      brokerElevated: false,
      cleanupElevated: false,
      accessDenied: false,
    },
  });
  return r;
}

/** Synthetic acceptance-oracle fixture. @returns {object} Fresh receipt. @since v0.19.2 */
export function recoveryReceipt() {
  const proof = {
    native: {
      pid: 71,
      tid: 81,
      birth: '116444736010000001',
      fromQpc: '100',
      toQpc: '200',
      reads: 160,
      pending: 160,
    },
    record: {
      provider: 'edd08927-9cc4-4e65-b970-c2560fb5c289',
      eventId: 15,
      version: 1,
      qpc: '150',
      issuerInterval: { fromQpc: '99', toQpc: '180' },
      generationInterval: { fromQpc: '160', toQpc: '170' },
      generationSource: 'createTime100ns',
      issuerStatus: 'verified',
      generationStatus: 'verified',
      issuerPid: 71,
      issuingTid: 81,
      generationWitness: '116444736010000001',
      instanceId: '71:1000',
      agent: 'Aider',
    },
  };
  return {
    status: 'PASS',
    productionAdmission: false,
    newSessionAfterRecovery: true,
    normal: { ...receipt(), syncProof: structuredClone(proof), asyncProof: structuredClone(proof) },
    crash: {
      status: 'PASS',
      closureConfirmed: true,
      failureVisible: true,
      guardClosureConfirmed: true,
      noAutomaticRestart: true,
      rapidExitNoWrongGeneration: true,
      rapidExitUnresolved: true,
      rapidExitObserved: 1,
      syncProof: structuredClone(proof),
      asyncProof: structuredClone(proof),
      summary: {
        recoveryVerified: true,
        stopVerified: false,
        exitCode: 4,
        collectorExit: 70,
        finalTotals: null,
        observationGap: true,
      },
    },
  };
}

/** Synthetic acceptance-oracle fixture. @returns {object} Fresh receipt. @since v0.19.2 */
export function failureReceipt() {
  return {
    status: 'PASS',
    productionAdmission: false,
    regression: recoveryReceipt(),
    cases: Object.fromEntries(
      [
        'collector-before-start',
        'collector-before-arm',
        'guard-exit',
        'broker-exit',
        'app-exit',
      ].map((mode) => [
        mode,
        {
          mode,
          status: 'PASS',
          packaged: true,
          diagnosticBuild: true,
          windowInputIsolated: true,
          closureConfirmed: true,
          contentExcluded: true,
          noDiagnosticAudit: true,
          before: { status: 4201, present: false },
          after: { status: 4201, present: false },
          presence: { status: 0, present: true },
          failureVisible: true,
          noAutomaticRestart: true,
          abruptAppExit: mode === 'app-exit',
          appExitCode: 73,
          restartBlocked: mode === 'broker-exit',
          summary: {
            recoveryVerified: mode.startsWith('collector-before-') || mode === 'guard-exit',
            recoveryCause:
              mode === 'guard-exit' ? 'collector-and-guard-exited' : 'collector-exited',
            capture: null,
            finalTotals: null,
            observationGap: true,
            collectorExit: mode === 'guard-exit' ? 2 : 70,
            exitCode:
              mode.startsWith('collector-before-') || mode === 'guard-exit'
                ? 4
                : mode === 'broker-exit'
                  ? 72
                  : 2,
            finalCounters: mode.startsWith('collector-before-')
              ? { queryStatus: mode === 'collector-before-start' ? 4201 : 0 }
              : mode === 'guard-exit'
                ? { queryStatus: 4201 }
                : null,
          },
        },
      ]),
    ),
  };
}

/** Synthetic acceptance-oracle fixture. @returns {object} Fresh receipt. @since v0.19.2 */
export function dualReceipt() {
  const r = failureReceipt();
  for (const mode of [
    'dual-before-start',
    'dual-before-arm',
    'dual-guard-first',
    'dual-collector-first',
  ]) {
    const c = structuredClone(r.cases['collector-before-arm']);
    c.mode = mode;
    c.helperPids = [71, 72, 73, 74];
    c.summary.stopVerified = false;
    c.summary.phase = 'recovered';
    c.summary.recoveryCause = 'collector-and-guard-exited';
    c.summary.finalCounters.queryStatus = mode === 'dual-before-start' ? 4201 : 0;
    r.cases[mode] = c;
  }
  return r;
}

/** Synthetic all-helper oracle fixture; no live evidence. @returns {object} Fresh receipt. @since v0.19.2 */
export function totalReceipt() {
  const r = dualReceipt();
  for (const mode of [
    'triple-before-start',
    'triple-before-arm',
    'triple-collector-first',
    'triple-guard-first',
    'triple-fallback-first',
    'triple-access-denied',
  ]) {
    const c = structuredClone(r.cases['dual-before-arm']);
    c.mode = mode;
    c.summary.recoveryCause = 'all-three-helpers-exited';
    c.summary.recoveryPeers = {
      guardExit: 71,
      fallbackExit: 74,
      brokerElevated: false,
      cleanupElevated: mode === 'triple-access-denied',
      accessDenied: mode === 'triple-access-denied',
    };
    c.summary.finalCounters.queryStatus = mode.endsWith('before-start') ? 4201 : 0;
    r.cases[mode] = c;
  }
  return r;
}
