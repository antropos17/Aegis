/**
 * Human-facing observation labels and grouping. Path context never supplies actor proof.
 * @since 0.14.1
 */
'use strict';
const { skillFromPath } = require('./skill-path');

/** @typedef {Record<string, unknown>} Observation */
/** @param {unknown} value @returns {string} @since 0.14.1 */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}
/** @param {Observation} row @returns {string} @since 0.14.1 */
function endpointLabel(row) {
  const host = text(row.domain) || text(row.remoteIp) || text(row.ip);
  const port = typeof row.remotePort === 'number' && row.remotePort > 0 ? row.remotePort : null;
  return host ? `${host.includes(':') ? `[${host}]` : host}${port ? `:${port}` : ''}` : '';
}
/** Recognize an application directory as resource context, never as its accessor.
 * @param {string} path @returns {string} @since 0.14.1
 */
function resourceContext(path) {
  const normalized = path.replaceAll('\\', '/');
  const roots = [
    [
      /(?:^|\/)\.codex(?:\/|$)|\/@openai\/codex(?:\/|$)|\/AppData\/Roaming\/Codex(?:\/|$)/i,
      'Codex',
    ],
    [/(?:^|\/)\.claude(?:\/|$)/i, 'Claude Code'],
    [/(?:^|\/)\.cursor(?:\/|$)/i, 'Cursor'],
    [/(?:^|\/)\.gemini(?:\/|$)/i, 'Gemini CLI'],
    [/\/\.config\/goose(?:\/|$)/i, 'Goose'],
    [/\/\.config\/opencode(?:\/|$)/i, 'OpenCode'],
  ];
  for (const [pattern, name] of roots) {
    if (pattern instanceof RegExp && pattern.test(normalized)) return String(name);
  }
  return '';
}
/** Explain a recorded evidence code without adding an ownership or safety claim.
 * @param {unknown} code Stored code @returns {string} Human explanation @since 0.14.1
 */
function observationEvidenceLabel(code) {
  const labels = {
    'rm-holder-pid': 'The operating system recorded a process holding this resource.',
    'handle-scan-pid': 'The process handle scan recorded this resource.',
    'os-tcp-owner-pid': 'The operating system recorded the process owning this connection.',
    'self-config-path': 'Matched an agent configuration directory; ownership is inferred.',
    'cwd-containment': 'Matched an agent working directory; ownership is inferred.',
    'no-owner-match': 'No observed agent matched this resource.',
    'no-ai-agents-online': 'No AI agent was observed when this event was recorded.',
    'population-unavailable': 'Process observation was unavailable when this event was recorded.',
    'ip-allowlist': 'The address matches a published operator IP range.',
    'domain-allowlist': 'The verified hostname matches the endpoint allowlist.',
    'domain-not-allowlisted': 'The hostname was verified but is not on the endpoint allowlist.',
    'ptr-missing': 'No reverse-DNS name was available; the lookup may also have failed.',
    'ptr-unconfirmed': 'The reverse-DNS name did not resolve back to this address.',
  };
  const key = text(code);
  return Object.hasOwn(labels, key)
    ? labels[key]
    : key.replaceAll('-', ' ') || 'No explanation was recorded.';
}
/** Describe known resource identity separately from actor attribution.
 * @param {Observation} row @param {Observation[]} [agents] Exact current instances
 * @returns {{actor: string, label: string, hint: string, context: string, skill: ReturnType<typeof skillFromPath>, resource: string, path: string, kind: string, attribution: string, explanation: string, source: string}}
 * @since 0.14.1
 */
function describeObservation(row, agents = []) {
  const path = text(row.file) || text(row.path);
  const skill = skillFromPath(path);
  const context = resourceContext(path);
  const evidence = row.attribution && typeof row.attribution === 'object' ? row.attribution : {};
  const status = 'status' in evidence ? evidence.status : row.attribution;
  const exact =
    typeof row.instanceId === 'string'
      ? agents.find((a) => a.instanceId === row.instanceId)
      : undefined;
  const recordedName = text(row.agent);
  const recorded = /^(?:unknown(?: source)?|unattributed|—)$/i.test(recordedName)
    ? ''
    : recordedName;
  const actor = status === 'unattributed' ? '' : recorded || (exact ? text(exact.agent) : '');
  const network = !!(row.remoteIp || row.domain || row.ip || row.type === 'network-connection');
  const attribution =
    status === 'confirmed'
      ? 'PID confirmed'
      : status === 'inferred'
        ? 'Indirect match'
        : status === 'ambiguous'
          ? 'Ambiguous ownership'
          : actor
            ? 'Recorded owner'
            : 'Actor not recorded';
  const codes = 'evidence' in evidence && Array.isArray(evidence.evidence) ? evidence.evidence : [];
  const relevantCodes = codes.filter((code) =>
    status === 'unattributed'
      ? ['no-owner-match', 'no-ai-agents-online', 'population-unavailable'].includes(code)
      : status === 'inferred'
        ? ['self-config-path', 'cwd-containment'].includes(code)
        : status === 'confirmed'
          ? ['rm-holder-pid', 'handle-scan-pid', 'os-tcp-owner-pid'].includes(code)
          : false,
  );
  const explanation = relevantCodes.length
    ? [...new Set(relevantCodes.map(observationEvidenceLabel))].join(' ')
    : actor
      ? 'The observation records this agent; no further attribution evidence was recorded.'
      : 'The observation does not identify an agent process.';
  return {
    actor,
    label: actor || context || (skill ? 'Shared skills' : 'Unattributed activity'),
    hint: actor
      ? attribution
      : context
        ? 'Resource context · actor not recorded'
        : skill
          ? 'Skill resource · actor not recorded'
          : 'No process evidence',
    context,
    skill,
    resource: skill
      ? skill.name
      : path
        ? path.split(/[/\\]/).filter(Boolean).pop() || path
        : endpointLabel(row) || text(row.detail) || text(row.type) || 'Observation',
    path: path || endpointLabel(row),
    kind: skill ? 'Skill' : network ? 'Network' : path ? 'File' : text(row.type) || 'Activity',
    attribution,
    explanation,
    source: text(row.source) || (network ? 'Network snapshot' : 'Not recorded'),
  };
}
/** @param {unknown} value @returns {number} @since 0.14.1 */
function observationTime(value) {
  const time = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? time : 0;
}

/** Normalize a display path without changing its recorded value or POSIX case.
 * @param {string} value Observed path @returns {string} Display grouping key @since 0.14.1
 */
function canonicalObservationPath(value) {
  const path = value.replaceAll('\\', '/');
  return /^(?:[a-z]:\/|\/\/)/i.test(path) ? path.toLowerCase() : path;
}
/** Summarize all recorded classifications, never just the latest row's evidence.
 * @param {Observation[]} rows Group members @param {Observation[]} [agents] Current instances @returns {string} Human evidence summary @since 0.14.1
 */
function observationGroupEvidence(rows, agents = []) {
  const labels = new Set();
  const attributions = new Set();
  for (const row of rows) {
    const info = describeObservation(row, agents);
    attributions.add(info.attribution);
    const stored = row.extra ?? row.details;
    const extra = stored && typeof stored === 'object' ? /** @type {Observation} */ (stored) : {};
    const verdict = row.verdict ?? extra.verdict;
    const label =
      info.kind === 'Network'
        ? verdict === 'allowlisted'
          ? 'Allowlisted'
          : verdict === 'flagged'
            ? 'Not allowlisted'
            : 'Endpoint unverified'
        : row.sensitive === true || row.severity === 'sensitive'
          ? 'Sensitive'
          : row.severity && !['normal', 'low'].includes(String(row.severity))
            ? String(row.severity)
            : info.attribution;
    labels.add(label);
    if (
      info.kind === 'Network' &&
      row.severity &&
      !['normal', 'low'].includes(String(row.severity))
    )
      labels.add(String(row.severity));
  }
  if (attributions.size > 1) labels.add('Mixed attribution');
  return [...labels].join(' · ');
}

/** @typedef {{key: string, label: string, rows: Observation[], latest: Observation, first: number, last: number}} ObservationGroup */
/** Group display rows without removing or changing the recorded evidence.
 * @param {Observation[]} rows @param {'resource'|'agent'|'none'} [mode] @param {Observation[]} [agents]
 * @returns {ObservationGroup[]} @since 0.14.1
 */
function groupObservations(rows, mode = 'resource', agents = []) {
  const grouped = new Map();
  rows.forEach((row, index) => {
    const info = describeObservation(row, agents);
    const actorKey = info.actor
      ? ['actor', info.actor]
      : row.instanceId
        ? ['instance', row.instanceId]
        : [
            'context',
            canonicalObservationPath(info.context || info.skill?.rootPath || 'unattributed'),
          ];
    const resource =
      info.skill?.rootPath ||
      text(row.file) ||
      text(row.path) ||
      [text(row.remoteIp) || text(row.domain), row.remotePort].filter(Boolean).join(':') ||
      text(row.detail) ||
      text(row.type);
    const key = JSON.stringify(
      mode === 'none'
        ? [index]
        : mode === 'agent'
          ? actorKey
          : [
              actorKey,
              info.kind === 'Network' ? resource.toLowerCase() : canonicalObservationPath(resource),
              info.kind,
            ],
    );
    const time = observationTime(row.timestamp);
    const group = grouped.get(key);
    if (group) {
      group.rows.push(row);
      group.first = Math.min(group.first, time);
      if (time > group.last) {
        group.last = time;
        group.latest = row;
      }
    } else
      grouped.set(key, {
        key,
        label: mode === 'agent' ? info.label : info.resource,
        rows: [row],
        latest: row,
        first: time,
        last: time,
      });
  });
  return [...grouped.values()].sort((a, b) => b.last - a.last || a.label.localeCompare(b.label));
}
module.exports = {
  observationEvidenceLabel,
  describeObservation,
  groupObservations,
  observationTime,
  endpointLabel,
  canonicalObservationPath,
  observationGroupEvidence,
};
