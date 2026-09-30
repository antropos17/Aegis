'use strict';

const { createOperationLedger } = require('../../../src/main/operation-ledger');

process.once('message', async ({ directory, binding }) => {
  try {
    const ledger = await createOperationLedger(directory);
    await ledger.consume(binding);
    process.send('consumed', () => process.exit(0));
  } catch {
    process.send('refused', () => process.exit(0));
  }
});
process.send('ready');
