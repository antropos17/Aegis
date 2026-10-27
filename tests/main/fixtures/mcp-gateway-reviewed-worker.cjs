'use strict';

// The parent owns the gateway process, its private input files and the effect file.
const path = require('node:path');
const { createMcpGateway } = require('../../../src/main/mcp-gateway');
const root = process.argv[2];
const file = (name) => path.join(root, name);
const send = (message) => {
  if (process.connected) process.send(message);
};
const gateway = createMcpGateway({
  policyPath: file('policy'),
  requestPath: file('request'),
  manifestPath: file('manifest'),
  grantStorePath: file('store'),
  disclosurePolicyPath: file('disclosure'),
  secretPolicyPath: file('secrets'),
  onFailure: () => send({ type: 'failure' }),
  reviewCall: async () => {
    send({ type: 'review' });
    return process.argv[3] !== 'deny';
  },
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  gateway.close();
  const clean = await gateway.finish();
  send({ type: 'stopped', clean });
  if (process.connected) process.disconnect();
}
process.on('message', async (message) => {
  if (message === 'initialize') {
    const response = await gateway.receive({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {} },
    });
    if (response.result)
      await gateway.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ type: 'initialized', ok: !!response.result });
  } else if (message === 'call') {
    const response = await gateway.receive({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'record', arguments: { recipient: 'chosen' } },
    });
    send({ type: 'result', error: response.error?.message ?? null });
  } else if (message === 'stop') await stop();
});
process.on('disconnect', stop);
