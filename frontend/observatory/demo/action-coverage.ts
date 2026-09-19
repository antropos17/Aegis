import { record, type RecordData } from '../runtime/host';

/** Explicit simulated configuration checks; never imported by the production entry.
 * @param request Preview selection @returns Fixed example envelope @since 0.15.1
 */
export async function previewActionCoverage(request: unknown): Promise<RecordData> {
  const options = record(request);
  const catalog = options.action === 'check-catalog';
  const routes = catalog
    ? ['mcp-stdio', 'mcp-review']
    : ['direct', 'terminal', 'mcp-stdio', 'mcp-review'];
  if (
    !['check-route', 'check-catalog'].includes(String(options.action)) ||
    !routes.includes(String(options.route)) ||
    Object.keys(options).some((key) => !['action', 'route'].includes(key))
  )
    return { success: false, error: 'invalid-review-request' };
  const route = String(options.route);
  const terminal = ['terminal', 'mcp-review'].includes(route);
  return {
    success: true,
    check: {
      id: crypto.randomUUID(),
      kind: catalog ? 'catalog' : 'single',
      route,
      createdAt: new Date().toISOString(),
      report: {
        schemaVersion: 1,
        mode: catalog ? 'action-catalog-check' : 'action-route-check',
        route,
        configuration: 'valid',
        policyDecision: catalog ? 'unknown' : 'allow',
        reason: catalog ? 'catalog-checked' : 'policy-allow',
        runtime: 'supported',
        terminal: terminal ? 'unavailable' : 'not-required',
        terminalScope: 'checking-process-only',
        askBehavior: terminal ? 'terminal-confirmation' : 'not-started',
        control: 'direct-child-only',
        descendantControl: 'unsupported',
        outsideRouteCoverage: 'unknown',
        connection: 'not-checked',
        blockingVerification: 'not-performed',
        executionPerformed: false,
        authorization: 'none',
        configurationObservation: catalog
          ? 'bounded-revision-check-not-retained'
          : 'single-pass-not-retained',
        gaps: [
          'other-agent-tools',
          'outside-route-filesystem-and-network',
          'descendants',
          'executable-content-binding',
          'continuous-configuration-watch',
          'provider-installation-and-version',
        ],
        ...(catalog
          ? {
              actions: ['allow', 'ask', 'deny'].map((decision) => ({
                name: 'aegis_action_demo_' + decision,
                configuration: 'valid',
                policyDecision: decision,
                reason: 'policy-' + decision,
              })),
            }
          : {}),
      },
    },
  };
}
