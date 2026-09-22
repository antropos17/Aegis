'use strict';
const { consumeGatewayGrant } = require('../../../src/main/mcp-gateway-grants');
const timer = setTimeout(() => process.exit(3), 10000);
process.once('message', async ({ storePath, grant, hold }) => {
  try {
    await consumeGatewayGrant(storePath, grant);
    process.send('consumed');
    if (!hold) {
      clearTimeout(timer);
      process.exit(0);
    }
  } catch {
    process.send('denied');
    clearTimeout(timer);
    process.exit(2);
  }
});
process.send('ready');
