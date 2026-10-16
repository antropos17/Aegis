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
