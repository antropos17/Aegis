'use strict';
const { serveMcpTransport } = require('./mcp-stdio-transport');
const { createMcpGateway } = require('./mcp-gateway');
const { captureGatewayRoute } = require('./mcp-gateway-route');
const { initializeGatewayCredentialKey } = require('./mcp-gateway-grants');

/** Prepare a store-backed tag for the explicitly selected HTTP(S) bearer.
 * This reads configuration but neither opens a network route nor runs a tool.
 * @param {string[]} args Exact CLI flag, endpoint and absolute grant store.
 * @param {(value: string) => void} write Bounded report writer.
 * @returns {Promise<number>} Zero only after key persistence and route recheck.
 * @since v0.17.0 */
async function handleMcpGatewayCredentialCLI(args, write) {
  if (
    args.length !== 3 ||
    args[0] !== '--mcp-gateway-credential-tag' ||
    args.slice(1).some((value) => typeof value !== 'string' || !value || value.startsWith('--'))
  )
    return 2;
  const controller = new AbortController();
  let route, key;
  try {
    route = await captureGatewayRoute({ endpointPath: args[1] }, controller.signal);
    key = await initializeGatewayCredentialKey(args[2]);
    await route.recheck();
    write(JSON.stringify({ credentialTag: route.credentialTag(key) }));
    return 0;
  } catch {
    return 2;
  } finally {
    key?.fill(0);
    route?.close();
    controller.abort();
  }
}

/** Prepare a store-backed tag for the policy-authorized effective stdio launch.
 * This reads configuration but never starts the selected upstream process.
 * @param {string[]} args Exact CLI flag, policy, request and absolute grant store.
 * @param {(value: string) => void} write Bounded report writer.
 * @returns {Promise<number>} Zero only after key persistence and route recheck.
 * @since v0.17.0 */
async function handleMcpGatewayStdioRouteTagCLI(args, write) {
  if (
    args.length !== 4 ||
    args[0] !== '--mcp-gateway-stdio-route-tag' ||
    args.slice(1).some((value) => typeof value !== 'string' || !value || value.startsWith('--'))
  )
    return 2;
  const controller = new AbortController();
  let route, key;
  try {
    route = await captureGatewayRoute(
      { policyPath: args[1], requestPath: args[2] },
      controller.signal,
    );
    await route.recheck();
    key = await initializeGatewayCredentialKey(args[3]);
    const launch = await route.recheck();
    write(JSON.stringify({ stdioRouteTag: route.stdioRouteTag(key, launch) }));
    return 0;
  } catch {
    return 2;
  } finally {
    key?.fill(0);
    route?.close();
    controller.abort();
  }
}

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
module.exports = {
  handleMcpGatewayCLI,
  handleMcpGatewayCredentialCLI,
  handleMcpGatewayStdioRouteTagCLI,
};
