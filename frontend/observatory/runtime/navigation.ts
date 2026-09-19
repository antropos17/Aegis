export interface Workspace {
  id: string;
  label: string;
  icon: string;
  group: string;
  keywords: string;
}
export const workspaceGroups = [
  { id: 'observe', label: 'Observe' },
  { id: 'investigate', label: 'Investigate' },
  { id: 'assess', label: 'Assess' },
  { id: 'configure', label: 'Configure' },
];
export const workspaces: Workspace[] = [
  {
    id: 'guide',
    label: 'Start here',
    icon: 'compass',
    group: 'observe',
    keywords: 'help guide getting started connect setup beginner tasks mcp terminal',
  },
  {
    id: 'overview',
    label: 'Monitoring',
    icon: 'radar',
    group: 'observe',
    keywords: 'radar live monitor monitoring',
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'robot',
    group: 'observe',
    keywords: 'process pid agent processes',
  },
  {
    id: 'stats',
    label: 'Statistics',
    icon: 'chartBar',
    group: 'observe',
    keywords: 'performance charts cpu ram graphs statistics task manager',
  },
  {
    id: 'events',
    label: 'Events',
    icon: 'fileSearch',
    group: 'investigate',
    keywords: 'files skills observations events',
  },
  {
    id: 'network',
    label: 'Network',
    icon: 'network',
    group: 'investigate',
    keywords: 'connections endpoints network',
  },
  {
    id: 'audit',
    label: 'Audit',
    icon: 'history',
    group: 'investigate',
    keywords: 'history evidence log audit',
  },
  {
    id: 'local-security',
    label: 'Local security',
    icon: 'folderSearch',
    group: 'assess',
    keywords: 'local security scan static inventory package skill hooks mcp snapshot changes cisco',
  },
  {
    id: 'action-control',
    label: 'Action control',
    icon: 'route',
    group: 'assess',
    keywords: 'action control coverage policy preflight check mcp catalog allow ask deny',
  },
  {
    id: 'analysis',
    label: 'AI analysis',
    icon: 'brain',
    group: 'assess',
    keywords: 'provider ai assessment analysis',
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'reportAnalytics',
    group: 'assess',
    keywords: 'export session report reports',
  },
  {
    id: 'rules',
    label: 'Rules & permissions',
    icon: 'adjustments',
    group: 'configure',
    keywords: 'policy access rules permissions',
  },
  {
    id: 'database',
    label: 'Agent catalog',
    icon: 'databaseSearch',
    group: 'configure',
    keywords: 'custom recognition catalog',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    group: 'configure',
    keywords: 'preferences theme motion scale settings animations',
  },
];
export interface WorkspaceCommand {
  id: string;
  label: string;
  caption: string;
  keywords: string;
  target: string;
  section?: string;
}
/** Searchable workspace destinations with stable category ordering. @returns Commands @since 0.14.1 */
export function workspaceCommands(): WorkspaceCommand[] {
  return workspaces.map((view) => ({
    ...view,
    caption: workspaceGroups.find((group) => group.id === view.group)!.label,
    target: view.id,
  }));
}
/** Matching destinations, accepting aliases and several words. @param commands Entries @param query Search @returns Matches @since 0.14.1 */
export function findCommands(commands: WorkspaceCommand[], query: string): WorkspaceCommand[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  return commands.filter((entry) => {
    if (
      !words.every((word) =>
        [entry.label, entry.caption, entry.keywords].join(' ').toLocaleLowerCase().includes(word),
      )
    )
      return false;
    const destination = JSON.stringify([entry.target, entry.section ?? '']);
    if (seen.has(destination)) return false;
    seen.add(destination);
    return true;
  });
}
