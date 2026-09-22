'use strict';

const { serveMcpTransport, LIMITS } = require('./mcp-stdio-transport');
let testDeps = null;

/**
 * Serve one finite newline-delimited MCP session on explicitly owned stdio.
 * Closing admission cancels the session and awaits its in-flight operations;
 * child cleanup must finish before the CLI exits. No diagnostic text is emitted.
 * @param {string[]} args Single-action flag and selected pair, or catalog flag and manifest.
 * @param {{observe?: Function}} [options] Trusted read-only observer hook.
 * @returns {Promise<number>} 0 for clean EOF, otherwise 2; stdout is protocol only.
 * @since v0.15.1
 */
function handleActionMcpStdio(args, options = {}) {
  const catalog = args[0] === '--action-mcp-catalog-stdio';
  const valid =
    args.length === (catalog ? 2 : 3) &&
    (catalog || args[0] === '--action-mcp-stdio') &&
    args.slice(1).every((arg) => typeof arg === 'string' && arg && !arg.startsWith('--'));
  return serveActionMcp({
    ...(options.observe ? { observe: options.observe } : {}),
    input: testDeps?.input || process.stdin,
    output: testDeps?.output || process.stdout,
    ...(catalog
      ? { catalogPath: valid ? args[1] : '' }
      : { policyPath: valid ? args[1] : undefined, requestPath: valid ? args[2] : undefined }),
  });
}

/**
 * Serve bounded MCP over owner-selected streams, including a shared duplex.
 * The optional executor is trusted local configuration, never client input.
 * @param {{input: NodeJS.ReadableStream, output: NodeJS.WritableStream, policyPath?: string, requestPath?: string, catalogPath?: string, execute?: Function, signal?: AbortSignal, observe?: Function}} options Owner transport and exclusive selected pair or catalog.
 * @returns {Promise<number>} Clean EOF status or failure after active cleanup.
 * @since v0.15.1
 */
function serveActionMcp({
  input,
  output,
  policyPath,
  requestPath,
  catalogPath,
  execute,
  signal,
  observe,
}) {
  const factory = testDeps?.createSession || require('./action-mcp').createActionMcp;
  return serveMcpTransport({
    input,
    output,
    signal,
    observe,
    createSession: () => {
      const catalog = catalogPath !== undefined;
      const valid = catalog
        ? typeof catalogPath === 'string' &&
          !!catalogPath &&
          policyPath === undefined &&
          requestPath === undefined
        : [policyPath, requestPath].every((arg) => typeof arg === 'string' && !!arg);
      if (!valid) throw Error('invalid-selection');
      return factory({
        ...(catalog ? { catalogPath } : { policyPath, requestPath }),
        ...(execute === undefined ? {} : { execute }),
      });
    },
  });
}
/** @param {object} deps Test streams and session factory. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = { handleActionMcpStdio, serveActionMcp, LIMITS, _setDepsForTest, _resetForTest };
