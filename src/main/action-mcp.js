'use strict';

const { executeAction } = require('./action-execution');
const VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26']);
const LIMITS = Object.freeze({ messages: 128, executions: 16 });
const NAME = 'aegis_execute_selected';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const idValid = (id) =>
  (Number.isSafeInteger(id) && id >= 0) ||
  (typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(id));
const response = (id, result) => ({ jsonrpc: '2.0', id, result });
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const only = (value, names) => Object.keys(value).every((key) => names.includes(key));
let testDeps = null;

/**
 * Own one MCP stdio connection for an operator-selected exact action. The client
 * can invoke the fixed action but cannot supply paths, argv or environment.
 * @param {{policyPath:string,requestPath:string,execute?: Function}} options Selected files and trusted owner execution callback.
 * @returns {object} Async receive and immediate admission-revoking close.
 * @since v0.15.1
 */
function createActionMcp({ policyPath, requestPath, execute: ownerExecute }) {
  if (ownerExecute !== undefined && typeof ownerExecute !== 'function')
    throw new Error('execution-owner-invalid');
  const execute = ownerExecute || testDeps?.execute || executeAction;
  const capture =
    testDeps?.capture ||
    ((...args) => require('./execution-binding').captureExecutionBinding(...args));
  const revoke =
    testDeps?.revoke ||
    ((binding) => require('./execution-binding').revokeExecutionBinding(binding));
  let phase = 'new';
  let messages = 0;
  let executions = 0;
  let protocolVersion = VERSIONS[0];
  let active = null;
  let binding = null;
  let initializing = null;
  const ids = new Set();
  const close = () => {
    if (phase === 'closed') return;
    phase = 'closed';
    initializing?.abort();
    active?.controller.abort();
    if (binding) {
      const current = binding;
      binding = null;
      revoke(current);
    }
    ids.clear();
  };

  async function receive(message) {
    if (phase === 'closed') return null;
    if (++messages > LIMITS.messages) {
      close();
      return null;
    }
    if (
      !object(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string' ||
      !only(message, ['jsonrpc', 'id', 'method', 'params']) ||
      (message.params !== undefined && !object(message.params))
    )
      return error(null, -32600, 'Invalid request');
    const params = message.params || {};
    const hasId = Object.hasOwn(message, 'id');
    if (!hasId) {
      if (message.method === 'notifications/initialized' && phase === 'initializing')
        phase = 'ready';
      if (
        message.method === 'notifications/cancelled' &&
        active &&
        params.requestId === active.id
      ) {
        active.cancelled = true;
        active.controller.abort();
      }
      return null;
    }
    if (!idValid(message.id)) return error(null, -32600, 'Invalid request identifier');
    const { id, method } = message;
    // Consume IDs before validation, including failed and busy requests. Retrying
    // an old ID can never cause a second side effect within this connection.
    if (ids.has(id)) return error(id, -32600, 'Duplicate request identifier');
    ids.add(id);
    if (method === 'ping') return response(id, {});
    if (method === 'initialize') {
      if (phase !== 'new') return error(id, -32600, 'Already initialized');
      if (
        typeof params.protocolVersion !== 'string' ||
        !object(params.capabilities) ||
        !object(params.clientInfo) ||
        typeof params.clientInfo.name !== 'string' ||
        typeof params.clientInfo.version !== 'string'
      )
        return error(id, -32602, 'Invalid initialization');
      phase = 'binding';
      const controller = new AbortController();
      initializing = controller;
      try {
        const captured = await capture(policyPath, requestPath, { signal: controller.signal });
        if (phase === 'closed') {
          if (captured) revoke(captured);
          return null;
        }
        if (!object(captured)) throw new Error('binding-unavailable');
        binding = captured;
      } catch (_) {
        if (phase === 'closed') return null;
        phase = 'failed';
        return error(id, -32000, 'Configuration unavailable');
      } finally {
        if (initializing === controller) initializing = null;
      }
      phase = 'initializing';
      protocolVersion = VERSIONS.includes(params.protocolVersion)
        ? params.protocolVersion
        : VERSIONS[0];
      return response(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'aegis-selected-action', version: '1.1.0' },
      });
    }
    if (phase !== 'ready') return error(id, -32002, 'Initialization required');
    if (method === 'tools/list') {
      if (!only(params, ['_meta'])) return error(id, -32602, 'Invalid parameters');
      return response(id, {
        tools: [
          {
            name: NAME,
            description:
              'Run the operator-selected action only if its current exact AEGIS policy allows. Child output is discarded. This tool does not isolate descendants.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
        ],
      });
    }
    if (method !== 'tools/call') return error(id, -32601, 'Method not found');
    if (
      !only(params, ['name', 'arguments', '_meta']) ||
      params.name !== NAME ||
      (params.arguments !== undefined &&
        (!object(params.arguments) || Object.keys(params.arguments).length))
    )
      return error(id, -32602, 'Invalid tool parameters');
    if (active) return error(id, -32000, 'Execution busy');
    if (executions >= LIMITS.executions) return error(id, -32000, 'Execution limit reached');
    executions++;
    const current = { id, controller: new AbortController() };
    active = current;
    try {
      const report = await execute(policyPath, requestPath, {
        signal: current.controller.signal,
        binding,
      });
      if (phase === 'closed' || current.cancelled) return null;
      const succeeded =
        report.decision === 'allow' &&
        report.execution.state === 'exited' &&
        report.execution.exitCode === 0 &&
        report.execution.outputComplete === true;
      return response(id, {
        content: [{ type: 'text', text: JSON.stringify(report) }],
        ...(protocolVersion === '2025-03-26' ? {} : { structuredContent: report }),
        isError: !succeeded,
      });
    } catch {
      return phase === 'closed' || current.cancelled
        ? null
        : response(id, {
            content: [
              { type: 'text', text: 'Execution status unavailable; execution may have started.' },
            ],
            isError: true,
          });
    } finally {
      if (active === current) active = null;
    }
  }
  return { receive, close };
}

/** @param {object} deps Trusted execution, capture and revocation seams. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = { createActionMcp, LIMITS, VERSIONS, NAME, _setDepsForTest, _resetForTest };
