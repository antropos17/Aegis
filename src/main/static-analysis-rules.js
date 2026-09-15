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
});

/** Return fresh versioned rule metadata. @returns {object} Built-in review rules. @since v0.15.1 */
function staticRuleSet() {
  return {
    id: 'aegis-static-patterns',
    version: 2,
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
