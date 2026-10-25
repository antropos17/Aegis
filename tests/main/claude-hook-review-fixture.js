import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createOwnedHookReview } = require('../../src/main/claude-hook-review');
const { IO_CONTRACT } = require('../../src/main/claude-hook-writer');
const { CONTRACT } = require('../../src/main/claude-hook-plan');
export { createOwnedHookReview };
export const configPath = 'X:/inert-owned-fixture/path-canary.json';
export const selection = {
  command: 'fixture-command command-canary',
  contract: CONTRACT,
  timeoutSeconds: 5,
};
export const original = '{"private":"config-canary","hooks":{"PreToolUse":[]}}';
// Independent expected bytes: no planner, edit applicator or review hash as oracle.
export const installed =
  '{"private":"config-canary","hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"fixture-command command-canary","timeout":5}]}]}}';

export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve() };
}

export function fixture(options = {}) {
  const state = {
    bytes: Buffer.from(original),
    identity: 'identity-canary',
    backups: [],
    writes: 0,
    time: 100,
    beforeRead: null,
    beforeWrite: null,
    clock: null,
    mode: 'written',
    retainFailure: false,
  };
  const owner = {};
  const io = {
    contract: IO_CONTRACT,
    async readTarget() {
      if (state.beforeRead) await state.beforeRead();
      return { identity: state.identity, bytes: Buffer.from(state.bytes) };
    },
    async retainPrivate(record) {
      const ref = {};
      state.backups.push({ ref, bytes: Buffer.from(record.bytes), manifest: record.manifest });
      if (state.retainFailure) throw Error('retained-private-canary');
      return ref;
    },
    async readPrivate(ref) {
      const record = state.backups.find((item) => item.ref === ref);
      return { bytes: Buffer.from(record.bytes), manifest: record.manifest };
    },
    async compareAndWrite({ identity, beforeBytes, afterBytes }) {
      if (state.beforeWrite) await state.beforeWrite();
      if (identity !== state.identity || !state.bytes.equals(beforeBytes)) return 'stale';
      state.writes += 1;
      state.bytes = Buffer.from(afterBytes);
      if (state.mode === 'throw') throw Error('exception-canary');
      if (state.mode === 'readback') state.bytes = Buffer.from('{"private":"readback-canary"}');
      return 'written';
    },
  };
  const review = createOwnedHookReview({
    owner,
    configPath,
    io,
    lifetimeMs: 20,
    now: () => (state.clock ? state.clock() : state.time),
    ...options,
  });
  return { owner, state, io, review };
}
