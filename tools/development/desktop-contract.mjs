/** Accept only a complete packaged-window lifecycle with confirmed original Job closure.
 * This is modeled installation authority, never enrollment or provider acceptance.
 * @param {object} result Desktop probe result.
 * @returns {boolean} Whether every required observation is present. @since v0.19.2
 */
export function desktopPassed(result) {
  const running = (state) =>
    state?.rootAlive === true &&
    state.released === true &&
    state.cleanupUnknown === false &&
    Number.isInteger(state.activeProcesses) &&
    state.activeProcesses >= 1 &&
    state.guiEnrollment === false &&
    state.launchAllowed === false;
  const stopped = (state) =>
    state?.state === 'stopped' &&
    state.rootAlive === false &&
    state.activeProcesses === 0 &&
    state.cleanupUnknown === false &&
    state.profileDataRetained === true &&
    state.guiEnrollment === false &&
    state.launchAllowed === false;
  return (
    result?.passed === true &&
    result.phase === 'complete' &&
    result.modeledAuthority === true &&
    result.guiEnrollment === false &&
    result.launchAllowed === false &&
    result.closureConfirmed === true &&
    result.chromiumProfileCreated === true &&
    result.sameEpochRetryRefused === true &&
    result.window?.Visible === true &&
    result.window.ImageHasContent === true &&
    Number.isInteger(result.window.Width) &&
    result.window.Width >= 640 &&
    Number.isInteger(result.window.Height) &&
    result.window.Height >= 400 &&
    running(result.start) &&
    running(result.query) &&
    result.query.activeProcesses >= 2 &&
    stopped(result.stop) &&
    stopped(result.afterStop) &&
    stopped(result.finalStop)
  );
}

/** Require the real packaged monitoring journey and confirmed owned cleanup.
 * @param {object} result Private monitoring probe receipt.
 * @returns {boolean} Whether every required observation is present. @since v0.19.2
 */
export function monitoringPassed(result) {
  const samples = result?.samples;
  return (
    result?.status === 'PASS' &&
    result.packaged === true &&
    result.windowInputIsolated === true &&
    result.snapshotClass === 'class5' &&
    result.fixtureDetected === true &&
    result.fixtureSelectable === true &&
    result.fixtureExited === true &&
    result.pauseRetained === true &&
    result.resumeExpired === true &&
    result.closureConfirmed === true &&
    !result.fixtureCleanupUnconfirmed &&
    !result.appCleanupUnconfirmed &&
    Number.isFinite(result.warmupObservedMs) &&
    result.warmupObservedMs >= 85000 &&
    Number.isInteger(result.batchCount) &&
    result.batchCount >= 4 &&
    Array.isArray(result.batches) &&
    result.batches.length === result.batchCount &&
    Array.isArray(samples) &&
    samples.length >= 2 &&
    samples.every(
      (sample, index) =>
        Number.isFinite(sample.at) &&
        /^(Live|Scanning)$/.test(sample.label) &&
        (index === 0 || sample.at >= samples[index - 1].at),
    ) &&
    samples.at(-1).at - samples[0].at >= 80000
  );
}

/** Require native file/socket observations, honest attribution, UI, audit and cleanup.
 * @param {object} r Private real-package sensor receipt.
 * @returns {boolean} Whether the controlled scenario is complete. @since v0.19.2
 */
export function sensorsPassed(r) {
  if (!r || !Array.isArray(r.files) || !Array.isArray(r.audit)) return false;
  const evidence = (row, code) => row.attribution?.evidence?.includes(code) === true;
  const owner = (row, code) =>
    row.pid === r.fixturePid &&
    row.instanceId === r.instanceId &&
    row.attribution?.status === 'confirmed' &&
    evidence(row, code);
  const pathOf = (row) => row.file ?? row.path ?? '';
  const filesValid = (rows) => {
    const changes = rows.filter((row) => pathOf(row).endsWith('.env.sensor-events'));
    return (
      JSON.stringify(changes.map((row) => row.action)) ===
        JSON.stringify(['created', 'modified', 'deleted', 'created']) &&
      changes.every(
        (row) =>
          row.pid === null &&
          row.instanceId === null &&
          row.attribution?.status === 'unattributed' &&
          evidence(row, 'no-owner-match'),
      ) &&
      ['.ssh', '.env.sensor-held'].every((suffix) =>
        rows.some(
          (row) =>
            pathOf(row).endsWith(suffix) && row.action === 'holding' && owner(row, 'rm-holder-pid'),
        ),
      )
    );
  };
  const live = r.networkLive;
  const sockets = live?.rows;
  return (
    r.status === 'PASS' &&
    r.packaged === true &&
    r.windowInputIsolated === true &&
    r.filesVisible === true &&
    r.networkVisible === true &&
    r.networkClearedVisible === true &&
    r.fixtureExited === true &&
    r.closureConfirmed === true &&
    r.contentExcluded === true &&
    r.leaked === false &&
    r.overflow === false &&
    !r.fixtureCleanupUnconfirmed &&
    !r.appCleanupUnconfirmed &&
    typeof r.witness === 'string' &&
    /^\d+$/.test(r.witness) &&
    filesValid(r.files) &&
    filesValid(r.audit.filter((row) => row.type === 'file-access')) &&
    r.files
      .filter((row) => row.action === 'holding')
      .every((row) => row.createTime100ns === r.witness) &&
    Array.isArray(sockets) &&
    sockets.length === 2 &&
    new Set(r.native?.ports).size === 2 &&
    new Set(sockets.map((row) => row.localPort)).size === 2 &&
    sockets.every(
      (row) =>
        owner(row, 'os-tcp-owner-pid') &&
        row.remoteIp === r.remoteIp &&
        row.remotePort === 443 &&
        r.native.ports.includes(row.localPort),
    ) &&
    live.at >= r.settingsSavedAt &&
    live.at - r.settingsSavedAt <= 20000 &&
    Array.isArray(r.network) &&
    r.network.every((sample) =>
      sample.rows.every((row) => row.remoteIp === r.remoteIp && row.remotePort === 443),
    ) &&
    r.networkClosed?.at > r.networkClosedAt &&
    r.networkClosed.rows?.length === 0 &&
    r.native.ports.every((port) =>
      r.audit.some(
        (row) =>
          row.type === 'network-connection' &&
          owner(row, 'os-tcp-owner-pid') &&
          row.details?.localPort === port,
      ),
    ) &&
    ['fs-chokidar', 'fs-rm', 'network'].every((id) => r.health?.[id]?.state === 'HEALTHY')
  );
}
