/** Project scanner conditions without retaining actor data or raw diagnostics.
 * @param {object|null} value Actual bounded main-process evidence.
 * @param {{pid:number,birth:string}} witness Independent fixture identity.
 * @returns {object} Fixed boolean conditions and a capped population count.
 * @since v0.20.1
 */
export function projectScannerReadiness(value, witness) {
  const agents = Array.isArray(value?.agents) ? value.agents : [];
  const populationReliable = value?.readiness?.populationReliable === true;
  const identityNonDegraded = value?.readiness?.identityDegraded === false;
  const monitoringActive = value?.readiness?.monitoringPaused === false;
  const isActor = (agent) => agent?.pid === witness.pid;
  const actorExactMatch = agents.some(
    (agent) =>
      isActor(agent) && agent.instanceIdSource === 'os' && agent.createTime100ns === witness.birth,
  );
  return {
    accepted: populationReliable && identityNonDegraded && monitoringActive && actorExactMatch,
    projectionAvailable: value != null,
    readinessAvailable: value?.readiness != null,
    agentsAvailable: Array.isArray(value?.agents),
    populationReliable,
    identityNonDegraded,
    monitoringActive,
    projectedAgentCount: Math.min(agents.length, 128),
    actorPidObserved: agents.some(isActor),
    actorOsIdentityObserved: agents.some(
      (agent) => isActor(agent) && agent.instanceIdSource === 'os',
    ),
    actorBirthMatched: agents.some(
      (agent) => isActor(agent) && agent.createTime100ns === witness.birth,
    ),
    actorExactMatch,
  };
}

/** Retain only the latest scanner condition sample before the caller's guard.
 * @param {object|null} value Actual bounded main-process evidence.
 * @param {{pid:number,birth:string}} witness Independent fixture identity.
 * @param {{samples:number,last:object|null}} observation Owned scenario receipt.
 * @returns {boolean} The unchanged strict scanner/actor acceptance decision.
 * @since v0.20.1
 */
export function recordScannerReadiness(value, witness, observation) {
  observation.last = projectScannerReadiness(value, witness);
  observation.samples = Math.min(observation.samples + 1, 512);
  return observation.last.accepted;
}
