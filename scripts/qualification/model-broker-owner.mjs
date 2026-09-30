import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { MODEL, INPUT } from './model-broker-fixture.mjs';
const require = createRequire(import.meta.url);
const { createSessionAuthority } = require('../../src/main/session-authority');
const { createOperationLedger } = require('../../src/main/operation-ledger');
const { createBoundedModelBroker } = require('../../src/main/model-broker');

/** Admit one generated dummy context at an explicit trusted owner boundary.
 * The allow decision applies only to this generated receiver, never production policy.
 * @param {object} fixture Trusted disposable fixture.
 * @param {function|undefined} wrapLedger Trusted test-only persistence fault seam.
 * @returns {Promise<object>} Private owner and fixed request issuer. @since v0.17.0 */
export async function createModelOwner(fixture, wrapLedger) {
  const authority = createSessionAuthority(
    {
      sessionId: 'a'.repeat(32),
      epoch: randomBytes(16).toString('hex'),
      policyRevision: 'c'.repeat(64),
    },
    { operations: ['model.request'] },
  );
  const ledger = await createOperationLedger(fixture.ledgerPath);
  let broker;
  try {
    broker = await createBoundedModelBroker({
      authority,
      ledger: wrapLedger?.(ledger) || ledger,
      endpointPath: fixture.endpointPath,
      model: MODEL,
    });
  } catch (error) {
    authority.revoke();
    throw error;
  }
  const prepare = (
    id = randomBytes(16).toString('hex'),
    bytes = Buffer.from(JSON.stringify(INPUT)),
  ) => {
    const prepared = broker.prepare(id, bytes);
    const capability = authority.issue(prepared.binding, { decision: 'allow' });
    return { prepared, capability, id };
  };
  return {
    authority,
    ledger,
    broker,
    prepare,
    close: () => {
      broker.close();
      authority.revoke();
    },
  };
}
