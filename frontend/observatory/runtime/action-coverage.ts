export const actionRoutes = [
  { id: 'direct', label: 'Direct execution' },
  { id: 'terminal', label: 'Terminal confirmation' },
  { id: 'mcp-stdio', label: 'MCP stdio' },
  { id: 'mcp-review', label: 'MCP terminal review' },
] as const;
export type ActionRoute = (typeof actionRoutes)[number]['id'];
export type ActionKind = 'single' | 'catalog';
export type Configuration = 'valid' | 'invalid' | 'unavailable' | 'not-checked';
export type PolicyDecision = 'allow' | 'ask' | 'deny' | 'unknown';
export type ActionRow = {
  name: string;
  configuration: Configuration;
  policyDecision: PolicyDecision;
  reason: string;
};
export type ActionCheck = {
  id: string;
  kind: ActionKind;
  route: ActionRoute;
  createdAt: string;
  report: {
    configuration: Configuration;
    policyDecision: PolicyDecision;
    reason: string;
    runtime: 'supported' | 'unsupported' | 'not-checked';
    terminal: 'available' | 'unavailable' | 'not-required' | 'not-checked';
    actions: ActionRow[];
  };
};
export const routeHelp: Record<ActionRoute, string> = {
  direct: 'Direct execution checks a command run through the AEGIS command line.',
  terminal: 'Terminal confirmation asks you before one command runs in an interactive terminal.',
  'mcp-stdio':
    'MCP stdio connects an agent to selected AEGIS tools. The policy decides whether each action may run.',
  'mcp-review':
    'MCP terminal review connects an agent while you approve each action in an interactive terminal.',
};

/** Explain a validated observation without implying execution or protection.
 * @param check Captured check. @returns Fixed summary and next-step text. @since 0.15.1 */
export function actionCheckGuidance(check: ActionCheck): { summary: string; next: string } {
  const { configuration, policyDecision, runtime, terminal } = check.report;
  if (configuration === 'invalid')
    return {
      summary: 'The selected files need attention.',
      next: 'Review the check details, correct the configuration files, then check again.',
    };
  if (configuration !== 'valid')
    return {
      summary: 'This check could not assess the configuration.',
      next:
        runtime === 'unsupported'
          ? 'Check again with the AEGIS command-line checker in the runtime you intend to use.'
          : 'Review the check details and choose the files again. No policy decision is available.',
    };
  const summary =
    check.kind === 'catalog'
      ? 'The catalog files are valid. Each action has its own policy decision below.'
      : policyDecision === 'allow'
        ? 'The policy allows this selected action. Nothing was run.'
        : policyDecision === 'ask'
          ? 'The policy requires your confirmation. Nothing was run.'
          : 'The policy denies this selected action. No blocking test was run.';
  const next =
    runtime !== 'supported'
      ? 'Check again with the AEGIS command-line checker in the runtime you intend to use.'
      : terminal === 'unavailable' || terminal === 'not-checked'
        ? 'Check this review route from an interactive terminal before using it.'
        : check.kind === 'catalog'
          ? 'Review each action below before connecting the catalog to your agent.'
          : policyDecision === 'deny'
            ? 'Keep this policy if the action should remain denied. Edit it only if you intend to change that decision.'
            : policyDecision === 'ask'
              ? 'Use a confirmation route when you are ready to review and approve the action.'
              : 'Review the selected command and policy before using the route with your agent.';
  return { summary, next };
}
const reasons = [
  'check-unavailable',
  'runtime-unsupported',
  'check-cancelled',
  'check-timeout',
  'policy-allow',
  'policy-ask',
  'policy-deny',
  'request-invalid',
  'policy-invalid',
  'input-unavailable',
  'catalog-unavailable',
  'configuration-changed',
  'catalog-checked',
  'catalog-invalid',
];
const gaps = [
  'other-agent-tools',
  'outside-route-filesystem-and-network',
  'descendants',
  'executable-content-binding',
  'continuous-configuration-watch',
  'provider-installation-and-version',
];
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
const configuration = (v: unknown): v is Configuration =>
  typeof v === 'string' && ['valid', 'invalid', 'unavailable', 'not-checked'].includes(v);
const decision = (v: unknown): v is PolicyDecision =>
  typeof v === 'string' && ['allow', 'ask', 'deny', 'unknown'].includes(v);
function outcome(value: Record<string, unknown>): boolean {
  if (
    !configuration(value.configuration) ||
    !decision(value.policyDecision) ||
    typeof value.reason !== 'string' ||
    !reasons.includes(value.reason)
  )
    return false;
  if (value.configuration === 'valid')
    return value.policyDecision !== 'unknown' && value.reason === 'policy-' + value.policyDecision;
  if (value.policyDecision !== 'unknown') return false;
  if (value.configuration === 'invalid')
    return ['request-invalid', 'policy-invalid'].includes(value.reason);
  return [
    'input-unavailable',
    'check-unavailable',
    'runtime-unsupported',
    'check-cancelled',
    'check-timeout',
  ].includes(value.reason);
}

/** Validate a captured check envelope without retaining private/unknown fields.
 * @param value Untrusted host envelope. @returns Typed observation or null. @since 0.15.1 */
export function parseActionCheck(value: unknown): ActionCheck | null {
  if (
    !object(value) ||
    !exact(value, ['id', 'kind', 'route', 'createdAt', 'report']) ||
    typeof value.id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id) ||
    (value.kind !== 'single' && value.kind !== 'catalog') ||
    !actionRoutes.some((route) => route.id === value.route) ||
    typeof value.createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt ||
    !object(value.report)
  )
    return null;
  const kind = value.kind as ActionKind,
    route = value.route as ActionRoute,
    report = value.report;
  const catalog = kind === 'catalog',
    terminalRoute = route === 'terminal' || route === 'mcp-review';
  if (catalog && !['mcp-stdio', 'mcp-review'].includes(route)) return null;
  const fixed: Record<string, unknown> = {
    schemaVersion: 1,
    mode: catalog ? 'action-catalog-check' : 'action-route-check',
    route,
    terminalScope: 'checking-process-only',
    askBehavior: terminalRoute ? 'terminal-confirmation' : 'not-started',
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
  };
  if (
    !exact(report, [
      ...Object.keys(fixed),
      'configuration',
      'policyDecision',
      'reason',
      'runtime',
      'terminal',
      'gaps',
      ...(catalog ? ['actions'] : []),
    ]) ||
    !Object.entries(fixed).every(([key, expected]) => report[key] === expected) ||
    !configuration(report.configuration) ||
    !decision(report.policyDecision) ||
    typeof report.reason !== 'string' ||
    !reasons.includes(report.reason) ||
    typeof report.runtime !== 'string' ||
    !['supported', 'unsupported', 'not-checked'].includes(report.runtime) ||
    typeof report.terminal !== 'string' ||
    !(terminalRoute ? ['available', 'unavailable', 'not-checked'] : ['not-required']).includes(
      report.terminal,
    ) ||
    !Array.isArray(report.gaps) ||
    report.gaps.length !== gaps.length
  )
    return null;
  const receivedGaps = report.gaps;
  if (
    !gaps.every((gap, i) => receivedGaps[i] === gap) ||
    (report.runtime !== 'supported' && report.configuration !== 'not-checked')
  )
    return null;
  const actions: ActionRow[] = [];
  if (catalog) {
    if (
      report.policyDecision !== 'unknown' ||
      !Array.isArray(report.actions) ||
      report.actions.length > 8
    )
      return null;
    for (const row of report.actions) {
      if (
        !object(row) ||
        !exact(row, ['name', 'configuration', 'policyDecision', 'reason']) ||
        typeof row.name !== 'string' ||
        !/^aegis_action_[a-z][a-z0-9_-]{0,31}$/.test(row.name) ||
        actions.some((prior) => prior.name === row.name) ||
        !outcome(row) ||
        row.configuration === 'not-checked'
      )
        return null;
      actions.push({
        name: row.name,
        configuration: row.configuration as Configuration,
        policyDecision: row.policyDecision as PolicyDecision,
        reason: row.reason as string,
      });
    }
    if (
      report.configuration === 'valid' &&
      (!actions.length ||
        actions.some((row) => row.configuration !== 'valid') ||
        report.reason !== 'catalog-checked')
    )
      return null;
    if (
      report.configuration === 'invalid' &&
      (!actions.some((row) => row.configuration === 'invalid') ||
        report.reason !== 'catalog-invalid')
    )
      return null;
  } else if (!outcome(report)) return null;
  return {
    id: value.id,
    kind,
    route,
    createdAt: value.createdAt,
    report: {
      configuration: report.configuration,
      policyDecision: report.policyDecision,
      reason: report.reason,
      runtime: report.runtime as ActionCheck['report']['runtime'],
      terminal: report.terminal as ActionCheck['report']['terminal'],
      actions,
    },
  };
}

export const coverageLabels: Record<string, string> = {
  valid: 'Configuration valid',
  invalid: 'Configuration invalid',
  unavailable: 'Unavailable',
  'not-checked': 'Not checked',
  allow: 'Allow',
  ask: 'Ask',
  deny: 'Deny',
  unknown: 'Unknown',
  supported: 'Supported',
  unsupported: 'Unsupported',
  available: 'Available',
  'not-required': 'Not required',
  'policy-allow': 'Policy allows this action',
  'policy-ask': 'Policy requires confirmation',
  'policy-deny': 'Policy denies this action',
  'request-invalid': 'The selected action request is invalid',
  'policy-invalid': 'The selected policy is invalid',
  'input-unavailable': 'Selected inputs could not be read',
  'check-unavailable': 'The check is unavailable',
  'runtime-unsupported': 'The current AEGIS runtime is unsupported for execution',
  'check-cancelled': 'The check was cancelled',
  'check-timeout': 'The check reached its time limit',
  'catalog-unavailable': 'The catalog check is unavailable',
  'configuration-changed': 'Configuration changed during the check',
  'catalog-checked': 'All selected configurations were checked',
  'catalog-invalid': 'The catalog contains an invalid configuration',
};
