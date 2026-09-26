/** Task descriptions shared by the guide and command search. */
export const guidedTasks = [
  {
    target: 'overview',
    title: 'See running agents',
    description: 'Watch agents, activity and observations that need review.',
    icon: 'radar',
  },
  {
    target: 'local-security',
    title: 'Check files before use',
    description:
      'Review a project or skill, inspect its contents, or compare it with a saved snapshot.',
    icon: 'folderSearch',
  },
  {
    target: 'action-control',
    title: 'Check an action setup',
    description: 'See how a selected action matches a policy before connecting it to an agent.',
    icon: 'route',
  },
];

export const moreTasks = [
  {
    target: 'agents',
    icon: 'robot',
    title: 'Inspect an agent',
    description: 'Open its processes, activity and available controls.',
  },
  {
    target: 'events',
    icon: 'fileSearch',
    title: 'Review file activity',
    description: 'Find observed file access and its recorded source.',
  },
  {
    target: 'network',
    icon: 'network',
    title: 'Review connections',
    description: 'Inspect observed network endpoints and attribution.',
  },
  {
    target: 'stats',
    icon: 'chartBar',
    title: 'Understand resource use',
    description: 'Compare CPU, memory, recorded tokens and sensor health.',
  },
  {
    target: 'analysis',
    icon: 'brain',
    title: 'Ask for an AI assessment',
    description: 'Configure a provider and review the evidence sent for analysis.',
  },
  {
    target: 'rules',
    icon: 'adjustments',
    title: 'Manage rules and preferences',
    description:
      'Edit detection rules and saved access preferences. Saved preferences do not block access.',
  },
  {
    target: 'database',
    icon: 'databaseSearch',
    title: 'Recognize another agent',
    description: 'Manage detection signatures in the agent catalog.',
  },
  {
    target: 'reports',
    icon: 'reportAnalytics',
    title: 'Export a report',
    description: 'Share recorded activity with its scope and limitations.',
  },
  {
    target: 'audit',
    icon: 'history',
    title: 'Review audit history',
    description: 'Inspect recorded decisions, related events and evidence.',
  },
  {
    target: 'settings',
    icon: 'settings',
    title: 'Adjust AEGIS',
    description: 'Change language, appearance, monitoring and data settings.',
  },
];

export const setupGuides = [
  {
    title: 'Connect selected actions',
    description:
      'Generate an MCP configuration for one action or a catalog of up to eight actions, then load it in your client.',
    file: 'ACTION-MCP-CONFIG.md',
  },
  {
    title: 'Require terminal approval',
    description:
      'Use the terminal review route and its operator approval flow for selected actions.',
    file: 'ACTION-MCP-REVIEW.md',
  },
  {
    title: 'Delete one selected file',
    description:
      'Set up the separate terminal-owned exact-file MCP route. Each accepted call needs a fresh terminal challenge.',
    file: 'ACTION-DELETE-FILE.md',
  },
  {
    title: 'Check a connected route',
    description:
      'Ask your MCP client for aegis_route_status to inspect that connection. It does not describe other agents.',
    file: 'ACTION-MCP-STATUS.md',
  },
];

/** Return a fixed documentation URL only for a listed setup guide.
 * @param file Guide filename.
 * @returns Trusted URL, or null for an unlisted filename.
 * @since 0.16.0
 */
export function setupGuideUrl(file: string): string | null {
  return setupGuides.some((guide) => guide.file === file)
    ? 'https://github.com/antropos17/Aegis/blob/master/docs/' + file
    : null;
}
