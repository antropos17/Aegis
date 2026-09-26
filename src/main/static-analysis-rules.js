'use strict';

// Fixed text only: never interpolate commands, URLs, tool names or matched values.
const RULES = Object.freeze({
  STA001: [
    'high',
    'Downloaded content is piped into an interpreter',
    'Review the downloaded code and its source before execution.',
  ],
  STA002: [
    'high',
    'Command can upload a sensitive file or environment value',
    'Review the data source, destination and explicit permission for this transfer.',
  ],
  STA003: [
    'high',
    'Recursive deletion targets a root or home directory',
    'Review the exact target and intended scope of deletion.',
  ],
  STA004: [
    'medium',
    'Encoded PowerShell command needs inspection',
    'The encoded payload is not decoded or evaluated by this analyzer.',
  ],
  STA005: [
    'medium',
    'Agent command requests permission bypass',
    'Review whether this execution should bypass the agent permission checks.',
  ],
  STA006: [
    'medium',
    'Package launcher uses a non-exact package version',
    'Review the package source and pin the reviewed version before launch.',
  ],
  STA007: [
    'medium',
    'Remote MCP endpoint uses unencrypted HTTP',
    'Review the transport and exposure of requests and credentials.',
  ],
  STA008: [
    'medium',
    'MCP URL embeds a credential field',
    'Review credential handling; the URL and its values are omitted from this report.',
  ],
  STA009: [
    'medium',
    'Configuration overrides the provider API endpoint',
    'Review which endpoint will receive API requests and authentication.',
  ],
  STA010: [
    'info',
    'Package declares an installation lifecycle script',
    'Review code that can run during package installation or preparation.',
  ],
  STA011: [
    'medium',
    'Dependency uses a mutable remote source',
    'Review the remote source and bind it to a reviewed immutable revision or artifact.',
  ],
  STA012: [
    'medium',
    'Instruction text asks to override prior instructions',
    'Review the instruction source and its authority before following this directive.',
  ],
  STA013: [
    'high',
    'Instruction text asks to transfer sensitive material',
    'Review the data, destination and explicit authorization for the requested transfer.',
  ],
  STA014: [
    'medium',
    'Instruction text asks to bypass consent',
    'Review the requested action and required approval before proceeding.',
  ],
  STA015: [
    'medium',
    'Instruction text asks to conceal an action from the user',
    'Review the concealed action and ensure the user can inspect its purpose and effects.',
  ],
  STA016: [
    'medium',
    'Claude settings declare broad execution preapproval',
    'Review the selected allow declaration and higher-precedence ask and deny rules. This static check does not establish effective permissions.',
  ],
  STA017: [
    'medium',
    'Claude skill declares broad execution preapproval',
    'Review whether this skill needs a tool grant for its invoking turn. Ask and deny rules take precedence; this static check does not establish effective permissions.',
  ],
  STA018: [
    'medium',
    'Claude settings declare permission bypass at session start',
    'Review the selected user or managed setting. Other settings and launch options can change the active mode; this static check does not establish it.',
  ],
  STA019: [
    'medium',
    'Claude project settings declare an ignored strict network allowlist',
    'Move the setting to user or managed settings, or CLI --settings. Verify Claude Code v2.1.219 or later and supported sandboxing; this static check does not establish effective network access.',
  ],
  STA020: [
    'medium',
    'Claude settings declare whole-server MCP tool preapproval',
    'Review the selected server-wide allow and higher-precedence ask and deny rules. This static check does not establish effective permissions or block tool calls.',
  ],
  STA021: [
    'medium',
    'Claude settings declare raw API body logging',
    'Review the selected telemetry setting and data retention. This static check does not establish whether logging is active or exported.',
  ],
});

/** Return fresh versioned rule metadata. @returns {object} Built-in review rules. @since v0.15.1 */
function staticRuleSet() {
  return {
    id: 'aegis-static-patterns',
    version: 12,
    rules: Object.entries(RULES).map(([id, [severity, title, recommendation]]) => ({
      id,
      severity,
      title,
      recommendation,
    })),
  };
}

/** Materialize a known finding using fixed wording. @param {string} id @returns {object} Rule metadata. @since v0.15.1 */
function staticRule(id) {
  if (!Object.hasOwn(RULES, id)) throw new Error('invalid-static-rule');
  const [severity, title, recommendation] = RULES[id];
  return { ruleId: id, severity, title, recommendation, confidence: 'heuristic' };
}

module.exports = { staticRule, staticRuleSet };
