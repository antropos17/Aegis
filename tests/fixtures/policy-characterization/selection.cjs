'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Create an owned disposable selection without executing its private arguments.
 * @returns {object} Paths, literal descriptors, writers and confined cleanup.
 * @since v0.19.2 */
function createSelection() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-policy-characterization-'));
  const policyPath = path.join(root, 'policy.json');
  const requestPath = path.join(root, 'request.json');
  const action = { executable: process.execPath, cwd: root, args: ['PRIVATE_ARGUMENT'], env: {} };
  const input = { command: 'PRIVATE_COMMAND', options: { timeout: 1, labels: ['a', 'b'] } };
  const providerRequest = {
    hook_event_name: 'PreToolUse',
    session_id: 'fixture_session',
    tool_use_id: 'fixture_tool',
    tool_name: 'Bash',
    cwd: root,
    tool_input: input,
  };
  return {
    root,
    policyPath,
    requestPath,
    action,
    input,
    providerRequest,
    write(policy, request = { schemaVersion: 1, action }) {
      fs.writeFileSync(policyPath, Buffer.isBuffer(policy) ? policy : JSON.stringify(policy));
      fs.writeFileSync(requestPath, Buffer.isBuffer(request) ? request : JSON.stringify(request));
    },
    cleanup() {
      if (path.dirname(root) !== path.resolve(os.tmpdir()) || fs.lstatSync(root).isSymbolicLink())
        throw Error('fixture-root-invalid');
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
module.exports = { createSelection };
