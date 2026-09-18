'use strict';

const { debuglog } = require('node:util');

/**
 * Reject unsupported hosts, permission-restricted Node and child-process diagnostics.
 * Node caches NODE_DEBUG at startup; inspecting process.env would miss that state.
 * @returns {boolean} Whether the current runtime may prepare or launch selected actions.
 * @since v0.15.1
 */
function isExecutionRuntimeSupported() {
  return (
    ['win32', 'linux', 'darwin'].includes(process.platform) &&
    !process.permission &&
    !debuglog('child_process').enabled
  );
}

module.exports = { isExecutionRuntimeSupported };
