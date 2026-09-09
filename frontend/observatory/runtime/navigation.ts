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
    keywords: 'radar live monitor радар мониторинг',
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'agents',
    group: 'observe',
    keywords: 'process pid агент процессы',
  },
  {
    id: 'stats',
    label: 'Statistics',
    icon: 'chart',
    group: 'observe',
    keywords: 'performance charts cpu ram графики статистика диспетчер',
  },
  {
    id: 'events',
    label: 'Events',
    icon: 'activity',
    group: 'investigate',
    keywords: 'files skills observations события файлы скилы',
  },
  {
    id: 'network',
    label: 'Network',
    icon: 'network',
    group: 'investigate',
    keywords: 'connections endpoints сеть соединения',
  },
  {
    id: 'audit',
    label: 'Audit',
    icon: 'history',
    group: 'investigate',
    keywords: 'history evidence журнал аудит',
  },
  {
    id: 'analysis',
    label: 'AI analysis',
    icon: 'shield',
    group: 'assess',
    keywords: 'provider ai assessment анализ',
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'report',
    group: 'assess',
    keywords: 'export session report отчеты отчёты экспорт',
  },
  {
    id: 'rules',
    label: 'Rules & permissions',
    icon: 'shield',
    group: 'configure',
    keywords: 'policy access rules правила разрешения',
  },
  {
    id: 'database',
    label: 'Agent catalog',
    icon: 'database',
    group: 'configure',
    keywords: 'custom recognition catalog каталог распознавание',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    group: 'configure',
    keywords: 'preferences theme motion scale настройки тема анимации',
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
/** Matching destinations, accepting localized aliases and several words. @param commands Entries @param query Search @returns Matches @since 0.14.1 */
export function findCommands(commands: WorkspaceCommand[], query: string): WorkspaceCommand[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter((entry) =>
    words.every((word) =>
      [entry.label, entry.caption, entry.keywords].join(' ').toLocaleLowerCase().includes(word),
    ),
  );
}
