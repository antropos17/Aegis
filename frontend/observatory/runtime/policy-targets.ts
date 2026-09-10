import { record, type RecordData } from './host';

interface PolicyAgent {
  name: string;
  instanceKey: string;
  parentEditor?: string | null;
  cwd?: string | null;
}
export interface PolicyTarget {
  key: string;
  label: string;
  name: string;
}

/** One editor target per durable saved policy, including inactive projects.
 * @param agents Observed processes @param permissions Saved policies @param selected Current draft
 * @returns Unique policy contexts @since 0.14.1
 */
export function policyTargets(
  agents: PolicyAgent[],
  permissions: RecordData,
  selected = '',
): PolicyTarget[] {
  const keys = new Set(
    [...agents.map((agent) => agent.instanceKey), ...Object.keys(permissions), selected].filter(
      (key) => key.includes('::'),
    ),
  );
  return [...keys].map((key) => {
    const matching = agents.filter(
      (agent) =>
        agent.instanceKey === key ||
        (agent.parentEditor &&
          `${agent.name}::${agent.parentEditor}` === key &&
          !Object.hasOwn(permissions, agent.instanceKey)),
    );
    const name = matching[0]?.name ?? key.slice(0, key.indexOf('::'));
    const context = key.slice(name.length + 2);
    return {
      key,
      name,
      label: `${name} · ${context} · ${matching.length ? `${matching.length} processes` : 'Not running'}`,
    };
  });
}

/** Resolve the same durable override fallback order as the backend.
 * @param key Selected policy @param agents Observed context @param permissions Saved policies
 * @returns Explicit or inherited values @since 0.14.1
 */
export function effectivePolicy(
  key: string,
  agents: PolicyAgent[],
  permissions: RecordData,
): RecordData {
  if (Object.hasOwn(permissions, key)) return record(permissions[key]);
  const agent = agents.find((item) => item.instanceKey === key);
  if (agent?.parentEditor) {
    const parentKey = `${agent.name}::${agent.parentEditor}`;
    if (Object.hasOwn(permissions, parentKey)) return record(permissions[parentKey]);
  }
  const name = agent?.name ?? key.split('::')[0];
  return record(permissions[name]);
}

/** Preserve a durable key through the existing atomic single-policy save API.
 * @param key Selected saved key @param agents Live context metadata @param project Project scope
 * @returns Exact persistence context, never a process action identity @since 0.14.1
 */
export function policySaveTarget(
  key: string,
  agents: PolicyAgent[],
  project: boolean,
): {
  agentName: string;
  parentEditor: string | null;
  cwd: string | null;
} {
  if (!project) return { agentName: key, parentEditor: null, cwd: null };
  const live = agents.find((agent) => agent.instanceKey === key);
  if (live)
    return { agentName: live.name, parentEditor: live.parentEditor ?? null, cwd: live.cwd ?? null };
  const separator = key.indexOf('::');
  const context = key.slice(separator + 2);
  if (separator < 0 || !context) throw new Error('Saved policy has no project context');
  // The backend concatenates name::context verbatim; no path parsing or normalization.
  return { agentName: key.slice(0, separator), parentEditor: context, cwd: null };
}
