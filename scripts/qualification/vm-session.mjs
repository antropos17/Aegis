import { randomBytes } from 'node:crypto';
import { binding, exactKeys, HEX64, requireVm } from './vm-contract.mjs';
import { createVmVerifier } from './vm-wire.mjs';

/**
 * Exercise admission/cleanup with a synthetic backend. No native mutation adapter
 * is provided. Supplied callbacks must be disposable test doubles, never host
 * commands. A backend label and registration metadata are not security checks.
 * @param {object} options Synthetic backend, registration, pins, journal and key.
 * @returns {Readonly<object>} Qualification controller, never production authority.
 * @since v0.17.0
 */
export function createVmSession({
  backend,
  identity,
  pins,
  journal,
  key,
  timeoutMs = 1000,
  recovery = false,
}) {
  const registered = binding(identity);
  exactKeys(pins, ['configSha256', 'imageSha256', 'runtimeSha256', 'principalSha256', 'jobSha256']);
  for (const hash of Object.values(pins)) requireVm(typeof hash === 'string' && HEX64.test(hash));
  const pinned = Object.freeze({ ...pins });
  requireVm(backend?.kind === 'synthetic-vm-fixture');
  for (const name of ['inspect', 'start', 'receive', 'release', 'stop'])
    requireVm(typeof backend[name] === 'function');
  requireVm(typeof journal?.append === 'function');
  requireVm(Number.isSafeInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 30000);
  requireVm(Buffer.isBuffer(key) && key.length === 32);
  const credential = Buffer.from(key);
  const pending = new Set();
  let state = recovery ? 'cleanup-unknown' : 'created';
  let generation = 0;
  let cancel = new AbortController();
  let verifier;
  let stopPromise;
  let journalHealthy = true;
  let used = recovery;

  function record(event) {
    try {
      journal.append(event);
    } catch {
      journalHealthy = false;
      throw new Error('vm-journal-unavailable');
    }
  }

  async function call(name, args, mutation = false) {
    const operation = Promise.resolve().then(() => {
      requireVm(!args.signal.aborted);
      return backend[name](registered, args);
    });
    if (mutation) {
      pending.add(operation);
      operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      );
    }
    let timer;
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('vm-operation-timeout')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function inspect(expected, signal = cancel.signal) {
    const observed = await call('inspect', { signal });
    exactKeys(observed, ['vmId', 'epoch', 'state', 'configSha256', 'pendingOperations']);
    requireVm(observed.vmId === registered.vmId && observed.epoch === registered.epoch);
    requireVm(observed.state === expected && observed.configSha256 === pinned.configSha256);
    requireVm(observed.pendingOperations === 0 && pending.size === 0);
  }

  function current(ticket) {
    requireVm(ticket === generation && !cancel.signal.aborted);
  }

  async function stopWork() {
    try {
      record('stop-intent');
    } catch {
      /* Cleanup still runs after a broken journal. */
    }
    try {
      const cleanupSignal = new AbortController().signal;
      await call('stop', { signal: cleanupSignal }, true);
      await inspect('off', cleanupSignal);
      requireVm(journalHealthy);
      record('stopped');
      state = 'stopped';
    } catch {
      state = 'cleanup-unknown';
      try {
        record('cleanup-unknown');
      } catch {
        /* Preserve uncertainty in memory too. */
      }
    }
    return snapshot();
  }

  function stop() {
    if (stopPromise) return stopPromise;
    if (state === 'stopped') return Promise.resolve(snapshot());
    generation++;
    cancel.abort();
    verifier?.close();
    credential.fill(0);
    state = 'stopping';
    stopPromise = stopWork().finally(() => {
      stopPromise = undefined;
    });
    return stopPromise;
  }

  function snapshot() {
    return Object.freeze({
      scope: 'synthetic-vm-controller',
      state,
      fixtureReleaseAllowed: state === 'ready',
      launchAllowed: false,
      nativeContainmentQualified: false,
      pendingOperations: pending.size,
    });
  }

  return Object.freeze({
    snapshot,
    stop,
    async prepare() {
      requireVm(state === 'created' && !used);
      used = true;
      state = 'starting';
      const ticket = generation;
      const challenge = randomBytes(32).toString('hex');
      const expected = {
        version: 1,
        ...registered,
        sequence: 1,
        challenge,
        phase: 'initialized',
        imageSha256: pinned.imageSha256,
        runtimeSha256: pinned.runtimeSha256,
        principalSha256: pinned.principalSha256,
        jobSha256: pinned.jobSha256,
      };
      verifier = createVmVerifier(credential, expected);
      try {
        record('created');
        await inspect('off');
        current(ticket);
        record('start-intent');
        await call('start', { signal: cancel.signal }, true);
        current(ticket);
        await inspect('running');
        current(ticket);
        const frame = await call('receive', { signal: cancel.signal, challenge });
        current(ticket);
        verifier.accept(frame);
        await inspect('running');
        current(ticket);
        record('ready');
        credential.fill(0);
        state = 'ready';
        return snapshot();
      } catch {
        await stop();
        throw new Error('vm-admission-unavailable');
      }
    },
    async release() {
      requireVm(state === 'ready');
      state = 'releasing';
      const ticket = generation;
      try {
        await inspect('running');
        current(ticket);
        record('release-intent');
        // Fixed fixture operation only; there is no command, path or content argument.
        await call('release', { signal: cancel.signal }, true);
        current(ticket);
        record('released');
        state = 'running';
        return snapshot();
      } catch {
        await stop();
        throw new Error('vm-release-unavailable');
      }
    },
  });
}
