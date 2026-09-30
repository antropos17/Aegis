import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { evaluateActionPolicy } = require('../../src/main/action-policy');
const { createSessionAuthority, digestSessionBytes } = require('../../src/main/session-authority');
const { createOperationLedger } = require('../../src/main/operation-ledger');
const { createSessionOperationBroker } = require('../../src/main/session-operation-broker');
const modes = ['allow', 'ask', 'deny', 'lost-response', 'revoked'];

async function cleanup(root, temporary) {
  if (
    path.dirname(root) !== temporary ||
    !path.basename(root).startsWith('aegis-session-qualification-') ||
    (await fs.lstat(root)).isSymbolicLink()
  )
    throw Error('session-qualification-cleanup-unavailable');
  await fs.rm(root, { recursive: true, force: true });
}

/** Exercise a fixed dummy corpus and existing policy evaluator, never project commands.
 * All writes are in one fresh disposable directory; no selector or real credential is accepted.
 * @param {string} mode Fixed qualification scenario.
 * @returns {Promise<object>} Redacted independently measured fixture result. @since v0.17.0 */
export async function qualifySessionAuthority(mode) {
  if (!modes.includes(mode)) throw Error('session-qualification-mode-invalid');
  const temporary = await fs.realpath(os.tmpdir());
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(temporary, 'aegis-session-qualification-')),
  );
  let authority;
  try {
    const store = path.join(root, 'ledger');
    await fs.mkdir(store);
    const decision = ['ask', 'deny'].includes(mode) ? mode : 'allow';
    const action = { command: 'fixed-dummy-fixture-label' };
    const policy = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        cwd: root,
        defaultDecision: 'deny',
        rules: [{ tool: 'Bash', input: action, decision }],
      }),
    );
    const filename = path.join(root, 'policy.json');
    await fs.writeFile(filename, policy, { flag: 'wx' });
    const request = Buffer.from(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'dummy-policy-session',
        tool_use_id: 'dummy-policy-action',
        tool_name: 'Bash',
        cwd: root,
        tool_input: action,
      }),
    );
    const snapshot = Buffer.from('fixed dummy snapshot');
    const policyOutcome = await evaluateActionPolicy(filename, request);
    authority = createSessionAuthority(
      {
        sessionId: 'a'.repeat(32),
        epoch: 'b'.repeat(32),
        policyRevision: digestSessionBytes(policy),
      },
      { operations: ['dummy-write'] },
    );
    const ledger = await createOperationLedger(store);
    let dispatchCount = 0;
    const sentinel = path.join(root, 'effect.bin');
    const broker = createSessionOperationBroker({
      authority,
      ledger,
      dispatchers: {
        'dummy-write': async ({ request: owned, signal }) => {
          if (signal.aborted || !owned.equals(request)) throw Error('dummy-binding-invalid');
          dispatchCount++;
          await fs.writeFile(sentinel, Buffer.from([0x5a]), { flag: 'wx' });
          if (mode === 'lost-response') throw Error('dummy-lost-response');
          return { status: 'completed' };
        },
      },
    });
    const operationId = randomBytes(16).toString('hex');
    const invocation = { operationId, operation: 'dummy-write', request, snapshot };
    let capability;
    try {
      capability = authority.issue(
        {
          operationId,
          operation: invocation.operation,
          requestDigest: digestSessionBytes(request),
          snapshotDigest: digestSessionBytes(snapshot),
          expiresAt: Date.now() + 10000,
        },
        policyOutcome,
        { approved: mode === 'ask' },
      );
    } catch {
      /* A policy deny cannot become dispatch authority. */
    }
    if (mode === 'revoked') authority.revoke();
    const result = capability
      ? await broker.dispatch(capability, invocation)
      : { state: 'refused' };
    const replay = capability
      ? await broker.dispatch(capability, invocation)
      : { state: 'refused' };
    let sentinelBytes = 0;
    try {
      const bytes = await fs.readFile(sentinel);
      if (!bytes.equals(Buffer.from([0x5a]))) throw Error('dummy-effect-invalid');
      sentinelBytes = bytes.length;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const expectedEffect = ['allow', 'ask', 'lost-response'].includes(mode) ? 1 : 0;
    const expectedState =
      mode === 'lost-response' ? 'outcome-unknown' : expectedEffect ? 'completed' : 'refused';
    if (
      dispatchCount !== expectedEffect ||
      sentinelBytes !== expectedEffect ||
      result.state !== expectedState ||
      replay.state !== 'refused'
    )
      throw Error('session-qualification-oracle-failed');
    return {
      schemaVersion: 1,
      mode,
      fixturePassed: true,
      policyDecision: policyOutcome.decision,
      state: result.state,
      replay: replay.state,
      dispatchCount,
      sentinelBytes,
      ledgerState: (await ledger.inspect(operationId)).state,
      launchAllowed: false,
      nativeContainmentQualified: false,
    };
  } finally {
    authority?.revoke();
    await cleanup(root, temporary);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error('invalid');
    console.log(JSON.stringify(await qualifySessionAuthority(process.argv[2])));
  } catch {
    console.log(JSON.stringify({ schemaVersion: 1, state: 'unavailable', launchAllowed: false }));
    process.exitCode = 2;
  }
}
