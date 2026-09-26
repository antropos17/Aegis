'use strict';

// A millisecond-only CIM fallback repeats instanceId's birth time and cannot
// separate two generations that share that millisecond.
const CONTROL_WITNESS_SOURCES = new Set(['sequence', 'createTime100ns', 'linuxStartTicks']);

/** Resolve a stamped process request against live AEGIS and OS observations.
 * The process map is observed after the request arrives; it is never cached here.
 * @param {{pid:number,instanceId:string,generationWitness:string,
 *   generationWitnessSource:string}} request Process target
 * @param {Object} deps Latest state getters and fresh process-map provider
 * @returns {Promise<{pid?:number,error?:string}>} Validated target
 * @since v0.14.1
 */
async function resolveProcessRequest(request, deps) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return { error: 'Invalid process instance' };
  }
  const { pid, instanceId, generationWitness, generationWitnessSource } = request;
  if (
    !Number.isInteger(pid) ||
    pid <= 0 ||
    typeof instanceId !== 'string' ||
    !instanceId ||
    typeof generationWitness !== 'string' ||
    !generationWitness ||
    typeof generationWitnessSource !== 'string' ||
    !CONTROL_WITNESS_SOURCES.has(generationWitnessSource)
  ) {
    return { error: 'Invalid process instance' };
  }

  const maxAgeMs =
    Number.isFinite(deps.maxObservationAgeMs) && deps.maxObservationAgeMs > 0
      ? deps.maxObservationAgeMs
      : 30000;
  const observedTarget = () => {
    const stats = deps.getStats?.();
    const asOf = stats?.appHealth?.populationAsOf;
    const age = Date.now() - asOf;
    if (
      stats?.appHealth?.populationReliable !== true ||
      stats.appHealth.identityDegraded === true ||
      stats.monitoringPaused === true ||
      ['SUSPENDED', 'RESUMED'].includes(stats.observationGap?.state) ||
      !Number.isFinite(asOf) ||
      age < 0 ||
      age > maxAgeMs
    ) {
      return { error: 'Process observation is unavailable or stale' };
    }
    const agents = deps.getLatestAgents?.();
    const agent = Array.isArray(agents)
      ? agents.find((entry) => entry.pid === pid && entry.instanceId === instanceId)
      : null;
    if (
      !agent ||
      agent.instanceIdSource !== 'os' ||
      agent.discoveryObservation?.stale ||
      !Number.isFinite(agent.startTime) ||
      agent.startTime <= 0 ||
      agent.instanceId !== `${pid}:${agent.startTime}` ||
      typeof agent.generationWitness !== 'string' ||
      !agent.generationWitness ||
      typeof agent.generationWitnessSource !== 'string' ||
      !agent.generationWitnessSource ||
      agent.generationWitness !== generationWitness ||
      agent.generationWitnessSource !== generationWitnessSource
    ) {
      return { error: 'Process instance changed or is no longer observed' };
    }
    return { agent };
  };

  const initial = observedTarget();
  if (initial.error) return { error: initial.error };
  // Capture values before the async OS read: the shared latest-agent object may
  // be replaced or mutated by a scan while the provider is answering.
  const initialStartTime = initial.agent.startTime;
  const initialWitness = initial.agent.generationWitness;
  const initialWitnessSource = initial.agent.generationWitnessSource;
  let processMap;
  try {
    if (typeof deps.getParentProcessMap !== 'function') {
      return { error: 'Process observation is unavailable or stale' };
    }
    processMap = await deps.getParentProcessMap();
  } catch (_) {
    return { error: 'Process observation is unavailable or stale' };
  }
  const current = observedTarget();
  if (current.error) return { error: current.error };
  const fresh = processMap instanceof Map ? processMap.get(pid) : null;
  if (
    !fresh ||
    !Number.isFinite(fresh.startTime) ||
    fresh.startTime !== initialStartTime ||
    fresh.startTime !== current.agent.startTime
  ) {
    return { error: 'Process instance changed or is no longer observed' };
  }
  const witness =
    typeof fresh.witness === 'string' &&
    fresh.witness &&
    typeof fresh.witnessSource === 'string' &&
    fresh.witnessSource
      ? { value: fresh.witness, source: fresh.witnessSource }
      : { value: String(fresh.startTime), source: 'startTimeMs' };
  if (
    witness.value !== initialWitness ||
    witness.source !== initialWitnessSource ||
    witness.value !== current.agent.generationWitness ||
    witness.source !== current.agent.generationWitnessSource
  ) {
    return { error: 'Process instance changed or is no longer observed' };
  }
  return { pid };
}

module.exports = { resolveProcessRequest };
