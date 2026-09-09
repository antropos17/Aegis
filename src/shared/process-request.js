'use strict';

/** Resolve Observatory's stamped request against the latest host observation.
 * Numeric requests remain compatible with the earlier renderer.
 * @param {number|{pid:number,instanceId:string}} request Process target
 * @param {Object} deps Latest snapshot getters
 * @returns {{pid?:number,error?:string}} Validated target
 * @since v0.14.1
 */
function resolveProcessRequest(request, deps) {
  if (!request || typeof request !== 'object') return { pid: Number(request) };
  const { pid, instanceId } = request;
  if (!Number.isInteger(pid) || pid <= 0 || typeof instanceId !== 'string' || !instanceId) {
    return { error: 'Invalid process instance' };
  }
  const stats = deps.getStats?.();
  if (
    stats?.appHealth?.populationReliable !== true ||
    stats.appHealth.identityDegraded === true ||
    stats.monitoringPaused === true ||
    ['SUSPENDED', 'RESUMED'].includes(stats.observationGap?.state)
  )
    return { error: 'Process observation is unavailable or stale' };
  const live = deps
    .getLatestAgents?.()
    .find((agent) => agent.pid === pid && agent.instanceId === instanceId);
  if (!live || live.instanceIdSource !== 'os' || live.discoveryObservation?.stale) {
    return { error: 'Process instance changed or is no longer observed' };
  }
  return { pid };
}

module.exports = { resolveProcessRequest };
