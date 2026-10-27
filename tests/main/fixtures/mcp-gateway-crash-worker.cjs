'use strict';

// Fixed test-only entrypoint: it opens only caller-selected synthetic fixture files.
const fs = require('node:fs');
const path = require('node:path');
const { createMcpGateway } = require('../../../src/main/mcp-gateway');
const root = process.argv[2];
const mode = process.argv[3];
if (!['effect', 'spent', 'decline'].includes(mode)) process.exit(2);
const file = (name) => path.join(root, name);
const gateway = createMcpGateway({
  policyPath: file('policy'),
  requestPath: file('request'),
  manifestPath: file('manifest'),
  grantStorePath: file('store'),
  disclosurePolicyPath: file('disclosure'),
  secretPolicyPath: file('secrets'),
  onFailure: () => {},
  reviewCall: async () => {
    fs.appendFileSync(file('reviews'), mode + '\n');
    return mode !== 'decline';
  },
});

(async () => {
  const initialized = await gateway.receive({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {} },
  });
  if (!initialized?.result) process.exit(4);
  await gateway.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const call = gateway.receive({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'record', arguments: { recipient: 'chosen' } },
  });
  if (mode !== 'effect') {
    const result = await call;
    gateway.close();
    const clean = await gateway.finish();
    fs.writeFileSync(
      file('result-' + mode),
      JSON.stringify({ error: result?.error?.message ?? null, clean }),
    );
    if (clean !== true) process.exit(8);
    process.stdout.write('ready\n');
    setTimeout(() => process.exit(9), 10000);
    return;
  }
  void call.then(
    () => process.exit(5),
    () => process.exit(5),
  );
  const started = performance.now();
  while (!fs.existsSync(file('effects'))) {
    if (performance.now() - started >= 1500) process.exit(6);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  process.stdout.write('ready\n');
})().catch(() => process.exit(7));
