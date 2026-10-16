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
