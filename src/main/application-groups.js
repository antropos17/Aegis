/**
 * @file application-groups.js
 * @description Presentation groups from one fresh process tree. Process identities
 * and individual records remain intact for attribution, sessions and actions.
 * @since 0.15.0
 */
'use strict';

const MAX_DEPTH = 64;

function hasBirth(info) {
  return info && Number.isFinite(info.startTime) && info.startTime > 0;
}

/**
 * Annotate detected processes with their highest observed same-agent ancestor.
 * Unmatched intermediate processes may bridge an ancestry path; a different
 * detected agent is a boundary. Every edge needs observed births in creation
 * order, preventing a recycled parent PID from joining unrelated processes.
 * Missing ancestors end the observed tree. Cycles/depth overflow are unknown.
 *
 * This describes observed process trees, not windows, chats or durable sessions.
 * Metadata is rebuilt each pass, never used to attribute events or dispatch actions.
 * Synthetic and unobserved identities have no group. No records are removed.
 * @param {Array} agents - Records already stamped with per-process identities.
 * @param {Map<number, object>|undefined} processMap - This pass's fresh observation.
 * @returns {void}
 * @since 0.15.0
 */
function annotateApplicationGroups(agents, processMap) {
  for (const agent of agents) delete agent.applicationGroup;
  if (!(processMap instanceof Map)) return;
  const byPid = new Map(agents.filter((a) => a.pid > 0).map((a) => [a.pid, a]));
  const eligible = (a) => {
    const info = processMap.get(a.pid);
    return (
      a.instanceIdSource === 'os' &&
      typeof a.instanceId === 'string' &&
      hasBirth(info) &&
      info.startTime === a.startTime
    );
  };
  const groups = new Map();
  for (const agent of agents) {
    if (!eligible(agent)) continue;
    let root = agent;
    let pid = agent.pid;
    const seen = new Set();
    for (;;) {
      if (seen.has(pid) || seen.size >= MAX_DEPTH) {
        root = null;
        break;
      }
      seen.add(pid);
      const child = processMap.get(pid);
      const parent = processMap.get(child?.ppid);
      if (!hasBirth(child) || !hasBirth(parent) || parent.startTime > child.startTime) break;
      const owner = byPid.get(child.ppid);
      if (owner) {
        if (owner.agent !== agent.agent || !eligible(owner)) break;
        root = owner;
      }
      pid = child.ppid;
    }
    if (!root) continue;
    const id = `app:${root.instanceId}`;
    let group = groups.get(id);
    if (!group) {
      group = { rootPid: root.pid, members: [] };
      groups.set(id, group);
    }
    group.members.push(agent);
  }
  for (const [id, group] of groups) {
    for (const member of group.members) {
      member.applicationGroup = { id, rootPid: group.rootPid, processCount: group.members.length };
    }
  }
}

module.exports = { annotateApplicationGroups };
