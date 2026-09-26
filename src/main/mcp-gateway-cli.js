'use strict';
const { serveMcpTransport } = require('./mcp-stdio-transport');
const { createMcpGateway } = require('./mcp-gateway');

/** Connect an explicitly selected upstream; stdout contains MCP only.
 * @param {string[]} args Stdio launch pair or HTTP descriptor, followed by accepted tools/grants.
 * @returns {Promise<number>} Exit 2 on loss or unconfirmed child/session cleanup. @since v0.15.1 */
async function handleMcpGatewayCLI(args) {
  let secretPolicyPath;
  const policyIndex = args.indexOf('--secret-policy');
  if (policyIndex !== -1) {
    if (
      policyIndex !== args.length - 2 ||
      typeof args[policyIndex + 1] !== 'string' ||
      !args[policyIndex + 1] ||
      args[policyIndex + 1].startsWith('--')
    )
      return 2;
    secretPolicyPath = args[policyIndex + 1];
    args = args.slice(0, policyIndex);
  }
  const http = args[0] === '--mcp-gateway-http';
  const required = http ? 3 : 4;
  if (
    ![required, required + 1].includes(args.length) ||
    (!http && args[0] !== '--mcp-gateway-stdio') ||
    args.slice(1).some((s) => typeof s !== 'string' || !s || s.startsWith('--'))
  )
    return 2;
  const controller = new AbortController();
  const session = createMcpGateway({
    ...(http
      ? { endpointPath: args[1], manifestPath: args[2] }
      : { policyPath: args[1], requestPath: args[2], manifestPath: args[3] }),
    grantStorePath: args[required],
    secretPolicyPath,
    onFailure: () => controller.abort(),
  });
  const lifetime = setTimeout(() => controller.abort(), 30000);
  const abort = () => controller.abort();
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  try {
    const code = await serveMcpTransport({
      input: process.stdin,
      output: process.stdout,
      signal: controller.signal,
      createSession: () => session,
    });
    session.close();
    return (await session.finish()) ? code : 2;
  } finally {
    clearTimeout(lifetime);
    session.close();
    await session.finish();
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}
module.exports = { handleMcpGatewayCLI };
