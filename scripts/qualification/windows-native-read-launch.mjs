/** Maximum time for the first Playwright connection in a newly provisioned guest. */
export const NATIVE_READ_ELECTRON_LAUNCH_TIMEOUT_MS = 90_000;

const SCHEMA = 'aegis-native-read-electron-launch/1';

function elapsedMilliseconds(started, now) {
  const elapsed = now() - started;
  return Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0;
}

function failureCode(error) {
  return error?.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(error?.message ?? '')
    ? 'timeout'
    : 'launch-error';
}

/**
 * Launch the packaged app with one bounded cold-guest deadline and a closed receipt projection.
 * The original Playwright rejection remains responsible for process cleanup and is rethrown.
 * @param {object} input Injected launch operation, immutable options and receipt destination.
 * @returns {Promise<object>} Playwright ElectronApplication.
 * @since v0.20.1
 */
export async function launchNativeReadElectron({ launch, options, observation, now = Date.now }) {
  const started = now();
  Object.assign(observation, {
    schema: SCHEMA,
    phase: 'launching',
    timeoutMilliseconds: NATIVE_READ_ELECTRON_LAUNCH_TIMEOUT_MS,
    returned: false,
    elapsedMilliseconds: 0,
  });
  delete observation.failureCode;

  try {
    const app = await launch({
      ...options,
      timeout: NATIVE_READ_ELECTRON_LAUNCH_TIMEOUT_MS,
    });
    Object.assign(observation, {
      phase: 'connected',
      returned: true,
      elapsedMilliseconds: elapsedMilliseconds(started, now),
    });
    return app;
  } catch (error) {
    Object.assign(observation, {
      phase: 'failed',
      returned: false,
      elapsedMilliseconds: elapsedMilliseconds(started, now),
      failureCode: failureCode(error),
    });
    throw error;
  }
}
