'use strict';

const path = require('node:path');
const MODES = Object.freeze({
  selected: Object.freeze({ flag: '--action-mcp-stdio', paths: 2 }),
  catalog: Object.freeze({ flag: '--action-mcp-catalog-stdio', paths: 1 }),
  relay: Object.freeze({ flag: '--action-mcp-connect', paths: 1 }),
});
let testDeps = null;
class ArgumentsError extends Error {
  constructor() {
    super('expected-action-mcp-config-arguments');
  }
}

function localPath(value, platform) {
  if (
    typeof value !== 'string' ||
    !value ||
    Buffer.byteLength(value, 'utf8') > 4096 ||
    /^[\\/]{2}/.test(value) ||
    // eslint-disable-next-line no-control-regex -- Path arguments cannot contain terminal controls.
    /[\x00-\x1f\x7f]/.test(value)
  )
    return false;
  return platform === 'win32'
    ? /^[a-z]:[\\/]/i.test(value) && !value.slice(2).includes(':')
    : path.posix.isAbsolute(value);
}

/**
 * Export literal client configuration for a selected route without reading or changing files.
 * Selected paths are intentionally included; contents, environment and endpoint tokens are not.
 * This generation performs no preflight and grants no approval or connection guarantee.
 * @param {'selected'|'catalog'|'relay'} mode Fixed route selector.
 * @param {string[]} paths Fully qualified local paths, retained without normalization.
 * @returns {object} Exact MCP stdio client configuration.
 * @since v0.15.1
 */
function buildActionMcpConfig(mode, paths) {
  const runtime = testDeps || {};
  const platform = runtime.platform ?? process.platform;
  if (
    typeof mode !== 'string' ||
    !Object.hasOwn(MODES, mode) ||
    !Array.isArray(paths) ||
    paths.length !== MODES[mode].paths ||
    !Array.from(paths).every((value) => localPath(value, platform))
  )
    throw new ArgumentsError();
  const command = runtime.execPath ?? process.execPath;
  const entry = runtime.mainPath ?? path.join(__dirname, 'main.js');
  if (
    (runtime.electron ?? process.versions.electron) ||
    !localPath(command, platform) ||
    !localPath(entry, platform)
  )
    throw Error('action-mcp-config-unavailable');
  return {
    mcpServers: { aegis: { type: 'stdio', command, args: [entry, MODES[mode].flag, ...paths] } },
  };
}

/**
 * Print exactly one configuration or fixed error; never install or launch it.
 * @param {string[]} args Flag, mode and selected path arguments.
 * @param {(text:string)=>void} write JSON output sink.
 * @returns {number} 0 generated, 1 invalid arguments, 2 unsupported/unavailable runtime.
 * @since v0.15.1
 */
function handleActionMcpConfigCLI(args, write) {
  let value,
    code = 0;
  try {
    if (!Array.isArray(args) || args[0] !== '--action-mcp-config-json') throw new ArgumentsError();
    value = buildActionMcpConfig(args[1], args.slice(2));
  } catch (error) {
    code = error instanceof ArgumentsError ? 1 : 2;
    value = {
      error: code === 1 ? 'expected-action-mcp-config-arguments' : 'action-mcp-config-unavailable',
    };
  }
  write(JSON.stringify(value));
  return code;
}

/** @param {object} deps Trusted runtime metadata only. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = { buildActionMcpConfig, handleActionMcpConfigCLI, _setDepsForTest, _resetForTest };
