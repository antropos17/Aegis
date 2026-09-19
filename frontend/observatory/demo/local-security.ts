import { record, type RecordData } from '../runtime/host';
import { previewActionCoverage } from './action-coverage';

/** Explicit preview fixtures. No filesystem, bridge, external scanner or network access.
 * @param request Preview operation @returns Simulated result @since 0.15.1
 */
export async function previewLocalSecurity(request: unknown): Promise<RecordData> {
  const options = record(request);
  if (['check-route', 'check-catalog'].includes(String(options.action)))
    return previewActionCoverage(request);
  if (options.action !== 'run') return { success: false, error: 'preview-action-unavailable' };
  const hash = 'a'.repeat(64);
  const files = [
    {
      path: 'AGENTS.md',
      sha256: hash,
      mode: 'instruction-patterns-and-code',
      kind: 'instruction',
      size: 148,
    },
  ];
  const local = {
    mode: 'static-analysis',
    complete: false,
    safety: 'not-determined',
    reviewRequired: true,
    ruleSet: { id: 'aegis-local-static', version: 7 },
    findings: [
      {
        ruleId: 'STA014',
        severity: 'medium',
        title: 'Instruction text asks to bypass consent',
        path: 'AGENTS.md',
        line: 12,
        sha256: hash,
        confidence: 'heuristic',
        recommendation: 'Review who authorized this action and whether approval is required.',
        instruction: { signal: 'consent-bypass' },
      },
    ],
    files,
    issues: [{ path: 'AGENTS.md', reason: 'instruction-semantics-not-analyzed' }],
    scope: {
      instructionPatterns: 'bounded-english-directives',
      instructionSemantics: 'not-analyzed',
      execution: 'not-performed',
    },
    limits: { instructionChars: 65536, instructionLines: 2048 },
    mcpCatalog: options.tools
      ? {
          complete: false,
          summary: { tools: 1, descriptions: 1, findings: 1, issues: 1 },
          findings: [
            {
              ruleId: 'STA013',
              severity: 'high',
              title: 'Instruction text requests sensitive-data transfer',
              toolIndex: 0,
              toolId: hash,
              toolSha256: hash,
              line: 2,
              context: 'mcp-tool-description',
              instruction: { signal: 'sensitive-data-transfer' },
            },
          ],
          issues: [{ reason: 'mcp-tool-fields-not-analyzed' }],
        }
      : null,
  };
  const catalog = options.tools
    ? { complete: true, sha256: hash, sourceSha256: hash, tools: [{ id: hash, sha256: hash }] }
    : null;
  const inventory = {
    mode: 'project-inventory',
    complete: true,
    components: files,
    issues: [],
    catalog,
    scope: { selection: 'explicit-directory', configurationPrecedence: 'not-resolved' },
    packages: [
      {
        manifest: 'package.json',
        sha256: hash,
        identity: { status: 'declared', name: 'example-skill', version: '1.0.0' },
        lockfile: { status: 'matches-declaration' },
        git: { status: 'not-observed' },
        publisher: 'not-verified',
        installation: 'not-established',
      },
    ],
  };
  const comparison = {
    mode: 'inventory-comparison',
    complete: true,
    status: 'review-required',
    contentUnchanged: false,
    baselineDigest: hash,
    currentDigest: 'b'.repeat(64),
    baselineState: 'accepted',
    inventory,
    catalog,
    changes: {
      components: { changed: [{ path: 'AGENTS.md', fields: ['content'] }] },
      packages: {},
      tools: {},
      catalogBytesChanged: false,
    },
  };
  const imported = {
    mode: 'static-analysis-import',
    complete: false,
    local,
    external: {
      source: {
        provider: 'cisco-skill-scanner',
        authenticity: 'unverified',
        execution: 'not-observed',
        sha256: hash,
      },
      findings: [
        {
          category: 'prompt_injection',
          severity: 'medium',
          locations: [{ path: 'AGENTS.md', line: 12, binding: 'observed-path-only' }],
        },
      ],
      issues: ['external-baseline-not-provided'],
    },
  };
  return {
    success: true,
    review: {
      id: crypto.randomUUID(),
      mode: options.mode,
      adapter: options.adapter,
      directory: 'Example / agent-project (simulated)',
      createdAt: new Date().toISOString(),
      report:
        options.mode === 'inventory'
          ? inventory
          : options.mode === 'compare'
            ? comparison
            : options.mode === 'import'
              ? imported
              : local,
      snapshot: ['inventory', 'compare'].includes(String(options.mode))
        ? {
            digest: hash,
            state: 'observed',
            complete: true,
            canAccept: options.mode === 'inventory',
          }
        : null,
      canSaveSnapshot: ['inventory', 'compare'].includes(String(options.mode)),
    },
  };
}
