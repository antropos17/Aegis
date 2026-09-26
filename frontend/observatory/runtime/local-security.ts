import { record, records, type RecordData } from './host';

export interface LocalReview {
  id: string;
  mode: string;
  adapter: string;
  directory: string;
  createdAt: string;
  report: RecordData;
  snapshot: { digest: string; state: string; complete: boolean; canAccept: boolean } | null;
  canSaveSnapshot: boolean;
}
export const reviewModes = [
  {
    id: 'scan',
    label: 'Security scan',
    description: 'Review commands, scripts, hooks, dependencies and instruction patterns.',
  },
  {
    id: 'inventory',
    label: 'Component inventory',
    description: 'List recognized agent files, package evidence and content fingerprints.',
  },
  {
    id: 'compare',
    label: 'Snapshot comparison',
    description: 'Compare fresh observations with a saved inventory snapshot.',
  },
  {
    id: 'import',
    label: 'External report',
    description: 'Import a Cisco result and compare its claims with a fresh local scan.',
  },
];
export const reviewAdapters = [
  {
    id: 'project',
    label: 'Project',
    hint: 'Select the project root. Reviews recognized agent locations and skill folders.',
  },
  {
    id: 'package',
    label: 'Skill / package folder',
    hint: 'Select one package root. Reviews the bounded file tree, excluding .git and links.',
  },
  {
    id: 'user-home',
    label: 'User home',
    hint: 'Select a home folder or a copy. Reviews recognized agent locations only.',
  },
  { id: 'codex-user', label: 'Codex user profile', hint: 'Select the .codex folder or a copy.' },
  { id: 'claude-user', label: 'Claude user profile', hint: 'Select the .claude folder or a copy.' },
  { id: 'cursor-user', label: 'Cursor user profile', hint: 'Select the .cursor folder or a copy.' },
  {
    id: 'gemini-user',
    label: 'Gemini CLI user settings',
    hint: 'Select the .gemini folder or a copy.',
  },
  {
    id: 'gemini-project',
    label: 'Gemini CLI project settings',
    hint: 'Select the project’s .gemini folder or a copy.',
  },
  {
    id: 'gemini-system-windows',
    label: 'Gemini CLI Windows system settings',
    hint: 'Select the Windows ProgramData gemini-cli folder or a copy.',
  },
  {
    id: 'vscode-user',
    label: 'VS Code user profile',
    hint: 'Select the profile directory containing mcp.json.',
  },
  {
    id: 'claude-managed',
    label: 'Claude managed settings',
    hint: 'Select the directory containing managed settings and policy fragments.',
  },
  {
    id: 'codex-managed',
    label: 'Codex managed settings',
    hint: 'Select the directory containing system configuration and requirements.toml.',
  },
];
export const reportFormats = [
  ['cisco-skill-json', 'Cisco Skill Scanner · JSON'],
  ['cisco-skill-sarif', 'Cisco Skill Scanner · SARIF 2.1.0'],
  ['cisco-mcp-json', 'Cisco MCP Scanner · JSON'],
];
const errors: Record<string, string> = {
  'review-busy': 'A local review is already running. Wait for it to finish.',
  'review-expired': 'This result is no longer available. Run the review again.',
  'snapshot-exists': 'Choose a new filename. Existing files are never overwritten.',
  'snapshot-inside-subject': 'Choose an artifact outside the directory being reviewed.',
  'snapshot-incomplete': 'An incomplete inventory cannot be accepted. Review the coverage gaps.',
  'snapshot-changed-since-review':
    'The content changed after review. Run a fresh comparison before accepting it.',
  'snapshot-digest-mismatch': 'The displayed snapshot no longer matches. Run the review again.',
  'snapshot-already-accepted': 'This snapshot was already accepted.',
  'snapshot-invalid': 'The selected file is not a valid supported inventory snapshot.',
  'tool-catalog-invalid': 'The MCP file is not a supported tools/list export.',
  'tool-catalog-unavailable': 'The selected MCP file could not be read within the file limits.',
  'external-baseline-invalid':
    'Select a previous AEGIS static-analysis JSON report as the baseline.',
  'external-report-unsupported-shape':
    'The external result does not match the selected report format.',
  'snapshot-unavailable':
    'A selected file or directory is unavailable, changed, linked or beyond the read limits.',
};
/** Fixed user-facing errors; filesystem and parser messages never become interface copy.
 * @param code Host error code @returns Explanation @since 0.15.1
 */
export function reviewError(code: unknown): string {
  return typeof code === 'string' && Object.hasOwn(errors, code)
    ? errors[code]
    : 'The local review could not complete. Check the selected inputs and retry.';
}
/** Read a confirmed host report without inventing a successful or complete result.
 * @param value Host envelope @returns Report or null @since 0.15.1
 */
export function localReview(value: unknown): LocalReview | null {
  const row = record(value);
  if (
    typeof row.id !== 'string' ||
    typeof row.mode !== 'string' ||
    typeof row.adapter !== 'string' ||
    typeof row.directory !== 'string' ||
    typeof row.createdAt !== 'string' ||
    !Object.keys(record(row.report)).length
  )
    return null;
  const snapshot = record(row.snapshot);
  return {
    id: row.id,
    mode: row.mode,
    adapter: row.adapter,
    directory: row.directory,
    createdAt: row.createdAt,
    report: record(row.report),
    canSaveSnapshot: row.canSaveSnapshot === true,
    snapshot:
      typeof snapshot.digest === 'string'
        ? {
            digest: snapshot.digest,
            state: String(snapshot.state),
            complete: snapshot.complete === true,
            canAccept: snapshot.canAccept === true,
          }
        : null,
  };
}
/** Select the built-in review in an imported-result envelope. @param report Result @returns Local evidence @since 0.15.1 */
export function localEvidence(report: RecordData): RecordData {
  return Object.keys(record(report.local)).length ? record(report.local) : report;
}
export interface ReviewRow {
  title: string;
  subtitle: string;
  severity?: string;
  evidence: RecordData;
}
const words = (value: unknown): string =>
  String(value ?? '')
    .replaceAll('-', ' ')
    .replaceAll('_', ' ');
/** Project bounded evidence into readable, individually inspectable rows.
 * @param report Main-owned report @param section Result section @returns All rows (the view paginates) @since 0.15.1
 */
export function reviewRows(report: RecordData, section: string): ReviewRow[] {
  const local = localEvidence(report);
  const inventory = Object.keys(record(report.inventory)).length ? record(report.inventory) : local;
  const mcp = record(local.mcpCatalog);
  const external = record(report.external);
  if (section === 'findings')
    return [
      ...records(local.findings).map((entry) => ({ ...entry, origin: 'Built-in analysis' })),
      ...records(mcp.findings).map((entry) => ({ ...entry, origin: 'Offline MCP description' })),
      ...records(external.findings).map((entry) => ({
        ...entry,
        origin: 'External claim · unverified',
      })),
    ].map((entry: RecordData) => ({
      title: String(entry.title ?? (words(entry.category) || 'External finding')),
      subtitle: `${entry.origin} · ${entry.path ?? (typeof entry.toolIndex === 'number' ? 'Tool #' + (entry.toolIndex + 1) : 'Unbound location')}${entry.line ? ' · ' + (entry.context === 'mcp-tool-description' ? 'Description line ' : 'Line ') + entry.line : ''}`,
      severity: String(entry.severity ?? 'unknown'),
      evidence: entry,
    }));
  if (section === 'files')
    return records(inventory.components ?? local.files).map((entry) => ({
      title: String(entry.path ?? 'Unobserved file'),
      subtitle: words(entry.kind ?? entry.mode),
      evidence: entry,
    }));
  if (section === 'packages')
    return records(inventory.packages).map((entry) => ({
      title: String(entry.manifest ?? 'Package manifest'),
      subtitle: 'Publisher unverified · installation not established',
      evidence: entry,
    }));
  if (section === 'tools')
    return records(record(report.catalog).tools).map((entry, index) => ({
      title: `Tool #${index + 1}`,
      subtitle: String(entry.id),
      evidence: entry,
    }));
  if (section === 'coverage') {
    const rows: ReviewRow[] = [];
    for (const [source, value] of [
      ['Local', inventory.issues],
      ['MCP description', mcp.issues],
      ['External report', external.issues],
    ] as const) {
      if (!Array.isArray(value)) continue;
      for (const issue of value) {
        const entry = typeof issue === 'string' ? { reason: issue } : record(issue);
        rows.push({
          title: words(entry.reason),
          subtitle: `${source}${entry.path ? ' · ' + entry.path : ''}`,
          evidence: entry,
        });
      }
    }
    if (record(inventory.catalog).complete === false || record(report.catalog).complete === false)
      rows.push({
        title: 'MCP catalog is incomplete',
        subtitle: 'More tools may exist on another page.',
        evidence: { reason: 'catalog-not-complete' },
      });
    return rows;
  }
  if (section === 'changes') {
    const changes = record(report.changes);
    const rows: ReviewRow[] = [];
    for (const kind of ['components', 'packages', 'tools']) {
      for (const status of ['added', 'removed', 'changed', 'newlyObserved', 'unobserved']) {
        const values = record(changes[kind])[status];
        if (!Array.isArray(values)) continue;
        for (const value of values) {
          const entry = typeof value === 'string' ? { reference: value } : record(value);
          rows.push({
            title: String(entry.path ?? entry.id ?? entry.reference),
            subtitle: `${kind} · ${status.replace(/([A-Z])/g, ' $1').toLowerCase()}`,
            evidence: entry,
          });
        }
      }
    }
    if (changes.catalogBytesChanged === true)
      rows.push({
        title: 'MCP catalog bytes changed',
        subtitle: 'Review the selected catalog again.',
        evidence: { changed: true },
      });
    return rows;
  }
  return [];
}
