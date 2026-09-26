'use strict';
const NAME = 'aegis_route_status';

/** @returns {object} Detached fixed status-tool descriptor. @since v0.15.1 */
function statusDescriptor() {
  return {
    name: NAME,
    description:
      'Inspect counters observed by this MCP connection only. This grants no execution permission and does not establish outside-route protection.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

/** Project owner-observed counters; private requests and reports are never accepted or retained.
 * @param {object} state Fixed counters and enum metadata from the connection owner.
 * @returns {object} Detached public snapshot. @since v0.15.1 */
function statusSnapshot(state) {
  return {
    schemaVersion: 1,
    mode: 'action-route-status',
    scope: 'current-mcp-connection',
    selection: state.catalogMode ? 'catalog' : 'single-action',
    selectedActionCount: state.selectedActionCount,
    activity: state.activity,
    messagesObserved: state.messages,
    actionAttempts: state.executions,
    selectionRejected: state.selectionRejected,
    ownerInvocations: state.ownerInvocations,
    ownerSettled: state.ownerSettled,
    ownerFailures: state.ownerFailures,
    cancellationRequests: state.cancellationRequests,
    limits: { messages: state.messageLimit, actionAttempts: state.executionLimit },
    authorization: 'none',
    control: state.kind === 'delete-file' ? 'selected-file-only' : 'direct-child-only',
    outsideRouteCoverage: 'unknown',
    descendantControl: state.kind === 'delete-file' ? 'not-applicable' : 'unsupported',
    blockingVerification: 'not-performed',
    providerIdentity: 'unverified',
  };
}
module.exports = { NAME, statusDescriptor, statusSnapshot };
