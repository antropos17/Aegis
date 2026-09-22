'use strict';
const { serveMcpTransport } = require('./mcp-stdio-transport');
const { createMcpGateway } = require('./mcp-gateway');

/** Start only an explicitly selected policy-authorized server; stdout contains MCP only.
 * @param {string[]} args Flag, launch policy, launch request, accepted tools/grants.
 * @returns {Promise<number>} Exit 2 on any lost boundary or unconfirmed direct-child cleanup. @since v0.15.1 */
async function handleMcpGatewayCLI(args) {
  if (
    args.length !== 4 ||
    args[0] !== '--mcp-gateway-stdio' ||
    args.slice(1).some((s) => typeof s !== 'string' || !s || s.startsWith('--'))
  )
    return 2;
  const controller = new AbortController();
  const session = createMcpGateway({
    policyPath: args[1],
    requestPath: args[2],
    manifestPath: args[3],
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
