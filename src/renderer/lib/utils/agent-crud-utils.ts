/**
 * Utilities for AgentDatabaseCrud — constants, form helpers, builder.
 */

/** Shape of the agent add/edit form. */
export interface AgentFormData {
  displayName: string;
  processName: string;
  category: string;
  description: string;
  riskProfile: string;
}

/** Category options for the agent form. */
export const CATEGORIES: [value: string, label: string][] = [
  ['coding-assistant', 'Coding Assistant'],
  ['ai-ide', 'AI IDE'],
  ['cli-tool', 'CLI Tool'],
  ['autonomous-agent', 'Autonomous'],
  ['desktop-agent', 'Desktop'],
  ['browser-agent', 'Browser'],
  ['agent-framework', 'Framework'],
  ['security-devops', 'Security'],
  ['ide-extension', 'IDE Extension'],
];

/** Returns a blank form for the "Add" dialog. */
export function createEmptyForm(): AgentFormData {
  return {
    displayName: '',
    processName: '',
    category: 'coding-assistant',
    description: '',
    riskProfile: 'low',
  };
}

/** Populates the form from an existing agent for the "Edit" dialog. */
export function formFromAgent(agent: Record<string, unknown>): AgentFormData {
  return {
    displayName: (agent.displayName as string) ?? '',
    processName: ((agent.names as string[]) ?? [])[0] ?? '',
    category: (agent.category as string) ?? 'coding-assistant',
    description: (agent.description as string) ?? '',
    riskProfile: (agent.riskProfile as string) ?? 'low',
  };
}

/** Builds a full custom-agent object from form data. */
export function buildCustomAgent(form: AgentFormData): Record<string, unknown> {
  return {
    id: 'custom-' + Date.now(),
    displayName: form.displayName.trim(),
    names: [form.processName.trim() || form.displayName.trim().toLowerCase()],
    category: form.category,
    description: form.description.trim(),
    riskProfile: form.riskProfile,
    vendor: 'Custom',
    icon: '\uD83D\uDD27',
    color: 'var(--md-sys-color-on-surface-variant)',
    defaultTrust: 50,
    knownDomains: [],
    knownPorts: [],
    configPaths: [],
    parentEditors: [],
    website: '',
  };
}

/** Applies form edits to an existing agent object. */
export function applyFormToAgent(
  agent: Record<string, unknown>,
  form: AgentFormData,
): Record<string, unknown> {
  return {
    ...agent,
    displayName: form.displayName.trim(),
    names: [form.processName.trim() || ((agent.names as string[]) ?? [])[0]],
    category: form.category,
    description: form.description.trim(),
    riskProfile: form.riskProfile,
  };
}
