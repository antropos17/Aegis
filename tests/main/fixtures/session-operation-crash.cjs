'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createSessionAuthority } = require('../../../src/main/session-authority');
const { createOperationLedger } = require('../../../src/main/operation-ledger');
const { createSessionOperationBroker } = require('../../../src/main/session-operation-broker');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const [mode, directory, operationId] = process.argv.slice(2);
  const request = {
    operationId,
    operation: 'dummy-edit',
    request: Buffer.from('harmless crash fixture request'),
    snapshot: Buffer.from('harmless crash fixture snapshot'),
  };
  const authority = createSessionAuthority(
    { sessionId: 'a'.repeat(32), epoch: 'b'.repeat(32), policyRevision: 'c'.repeat(64) },
    { operations: ['dummy-edit'] },
  );
  const ledger = await createOperationLedger(path.join(directory, 'ledger'));
  let effects = 0;
  const broker = createSessionOperationBroker({
    authority,
    ledger,
    dispatchers: {
      'dummy-edit': async () => {
        effects++;
        const effect = await fs.open(path.join(directory, 'effect.txt'), 'a', 0o600);
        try {
          await effect.writeFile('effect\n');
          await effect.sync();
        } finally {
          await effect.close();
        }
        if (mode === 'crash') {
          // The real broker has consumed and rechecked its spend. Keep its callback
          // pending so no settle call can run before the parent kills this process.
          process.send({ stage: 'effect-synced', pid: process.pid });
          await new Promise(() => {});
        }
        return { status: 'completed' };
      },
    },
  });
  // Recovery observation must not seed the broker ledger's in-memory history.
  const observer = await createOperationLedger(path.join(directory, 'ledger'));
  const before = await observer.inspect(operationId);
  const capability = authority.issue(
    {
      operationId,
      operation: request.operation,
      requestDigest: hash(request.request),
      snapshotDigest: hash(request.snapshot),
      expiresAt: Date.now() + 30000,
    },
    { decision: 'allow' },
  );
  const receipt = await broker.dispatch(capability, request);
  const after = await ledger.inspect(operationId);
  authority.revoke();
  process.send({ stage: 'recovered', pid: process.pid, before, after, receipt, effects }, () => {
    process.disconnect();
  });
}

// Keep IPC referenced while the dispatch callback waits for abrupt termination.
process.on('message', () => {});
main().catch(() => {
  process.exitCode = 1;
  process.disconnect();
});
