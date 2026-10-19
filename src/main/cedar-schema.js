'use strict';

const SCHEMA_ID = 'aegis-execution-v1';
const string = { type: 'String' };
const SCHEMA = {
  AEGIS: {
    entityTypes: {
      UnboundAgent: { shape: { type: 'Record', attributes: {} } },
      Execution: {
        shape: {
          type: 'Record',
          attributes: { executable: string, cwd: string, args: string, env: string },
        },
      },
    },
    actions: {
      exec: {
        appliesTo: {
          principalTypes: ['UnboundAgent'],
          resourceTypes: ['Execution'],
          context: { type: 'Record', attributes: {} },
        },
      },
    },
  },
};
function freeze(value) {
  Object.values(value).forEach((child) => {
    if (child && typeof child === 'object') freeze(child);
  });
  return Object.freeze(value);
}
freeze(SCHEMA);

/**
 * Encode exact strings and ordered arguments without Cedar set coercion.
 * Environment key order is insignificant, as in equalActionValue.
 * @param {object} action Already validated execution descriptor.
 * @returns {object} Private Cedar resource attributes. Never log or export.
 * @since v0.19.2
 */
function executionAttributes(action) {
  return {
    executable: action.executable,
    cwd: action.cwd,
    args: JSON.stringify(action.args),
    env: JSON.stringify(
      Object.fromEntries(
        Object.entries(action.env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    ),
  };
}

module.exports = { SCHEMA_ID, SCHEMA, executionAttributes };
