import { encodeVmFrame } from '../../scripts/qualification/vm-wire.mjs';

export const identity = {
  sessionId: 'a'.repeat(32),
  vmId: '11111111-2222-3333-4444-555555555555',
  epoch: 'b'.repeat(32),
};
export const pins = {
  configSha256: 'c'.repeat(64),
  imageSha256: 'd'.repeat(64),
  runtimeSha256: 'e'.repeat(64),
  principalSha256: 'f'.repeat(64),
  jobSha256: '0'.repeat(64),
};
export const key = Buffer.alloc(32, 17);

/** @param {string} challenge @param {object} overrides @returns {object} @since v0.17.0 */
export function evidence(challenge = '1'.repeat(64), overrides = {}) {
  return {
    version: 1,
    ...identity,
    sequence: 1,
    challenge,
    phase: 'initialized',
    imageSha256: pins.imageSha256,
    runtimeSha256: pins.runtimeSha256,
    principalSha256: pins.principalSha256,
    jobSha256: pins.jobSha256,
    ...overrides,
  };
}

/** @returns {object} Controllable test-only completion. @since v0.17.0 */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** @returns {object} In-memory callbacks with no native effects. @since v0.17.0 */
export function syntheticFixture() {
  const events = [];
  const calls = [];
  const observed = {
    vmId: identity.vmId,
    epoch: identity.epoch,
    state: 'off',
    configSha256: pins.configSha256,
    pendingOperations: 0,
  };
  const backend = {
    kind: 'synthetic-vm-fixture',
    async inspect() {
      calls.push('inspect');
      return { ...observed };
    },
    async start(registration) {
      calls.push('start');
      if (registration.vmId !== identity.vmId) throw new Error('foreign');
      observed.state = 'running';
    },
    async receive(registration, { challenge }) {
      calls.push('receive');
      return encodeVmFrame(key, evidence(challenge));
    },
    async release() {
      calls.push('release');
    },
    async stop() {
      calls.push('stop');
      observed.state = 'off';
    },
  };
  return {
    backend,
    observed,
    calls,
    events,
    options: {
      backend,
      identity: { ...identity },
      pins: { ...pins },
      key: Buffer.from(key),
      journal: {
        append(event) {
          events.push(event);
        },
      },
      timeoutMs: 30,
    },
  };
}
