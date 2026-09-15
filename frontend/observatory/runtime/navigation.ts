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
    id: 'overview',
    label: 'Monitoring',
    icon: 'radar',
    group: 'observe',
    keywords: 'radar live monitor monitoring',
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'agents',
    group: 'observe',
    keywords: 'process pid agent processes',
  },
  {
    id: 'stats',
    label: 'Statistics',
    icon: 'chart',
    group: 'observe',
    keywords: 'performance charts cpu ram graphs statistics task manager',
  },
  {
    id: 'events',
    label: 'Events',
    icon: 'activity',
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
    id: 'analysis',
    label: 'AI analysis',
    icon: 'shield',
    group: 'assess',
    keywords: 'provider ai assessment analysis',
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'report',
    group: 'assess',
    keywords: 'export session report reports',
  },
  {
    id: 'rules',
    label: 'Rules & permissions',
    icon: 'shield',
    group: 'configure',
    keywords: 'policy access rules permissions',
  },
  {
    id: 'database',
    label: 'Agent catalog',
    icon: 'database',
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
  return commands.filter((entry) =>
    words.every((word) =>
      [entry.label, entry.caption, entry.keywords].join(' ').toLocaleLowerCase().includes(word),
    ),
  );
}
