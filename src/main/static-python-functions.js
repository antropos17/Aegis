'use strict';

const { commaGroups } = require('./static-python-tree');
const { UNKNOWN } = require('./static-python-values');

/** Recognize one plain return or process-wrapper statement. @param {object} model @param {object} binding @returns {object|null} Plain parameters and expression, or unsupported. @since v0.15.1 */
function pythonFunctionShape(model, binding) {
  const { definition, inner } = binding;
  if (
    !definition ||
    binding.mutated ||
    inner.dynamic ||
    model.index.parents.get(definition) !== model.parsed.root ||
    definition.children.length !== 4 ||
    definition.children[0]?.type !== 'def'
  )
    return null;
  const params = definition.children.find((node) => node.type === 'ParamList');
  const groups = commaGroups(params?.children.slice(1, -1) ?? []);
  if (
    groups.length > 8 ||
    groups.some((group) => group.length !== 1 || group[0].type !== 'VariableName')
  )
    return null;
  const parameters = groups.map(([node]) => inner.bindings.get(model.parsed.identifier(node)));
  if (parameters.some((parameter) => parameter?.kind !== 'parameter' || parameter.mutated))
    return null;
  const body = definition.children.find((node) => node.type === 'Body');
  const statements = (body?.children ?? []).filter((node) => ![':', 'Comment'].includes(node.type));
  if (statements[0]?.type === 'ExpressionStatement' && statements[0].children[0]?.type === 'String')
    statements.shift();
  if (statements.length !== 1) return null;
  const statement = statements[0];
  const returns = statement.type === 'ReturnStatement';
  const expression = returns
    ? statement.children[1]
    : statement.type === 'ExpressionStatement'
      ? statement.children[0]
      : null;
  return expression && (returns || expression.type === 'CallExpression')
    ? { parameters, expression, returns }
    : null;
}

/** Bound wrapper and return expansion with the same frames and resources. @param {object} limits @param {object} hooks Work, evidence and fixed-issue callbacks. @returns {object} Function expansion and parameter lookup. @since v0.15.1 */
function createPythonFunctions(limits, hooks) {
  const active = new Set();
  const frames = [];
  let expansions = 0,
    depth = 0;
  function expand(model, node, target, returning, callback) {
    if (!hooks.work()) return UNKNOWN;
    if (expansions++ >= limits.flowCalls) return hooks.fail('flow-call-limit');
    if (depth >= limits.flowDepth) return hooks.fail('flow-depth-limit');
    if (active.has(target.binding)) return hooks.fail('python-call-cycle-not-resolved');
    const shape = pythonFunctionShape(target.model, target.binding);
    if (!shape || (returning && !shape.returns)) return hooks.fail('python-function-not-resolved');
    const argList = node.children[1];
    const arguments_ = commaGroups(argList?.children.slice(1, -1) ?? []);
    if (
      argList?.type !== 'ArgList' ||
      arguments_.length !== shape.parameters.length ||
      arguments_.some((group) => group.length !== 1)
    )
      return hooks.fail('python-function-arguments-not-resolved');
    depth++;
    try {
      const values = arguments_.map(([argument]) => model.values.read(argument));
      if (
        values.some(
          (value) =>
            !isPythonPrimitive(value) &&
            !(
              !returning &&
              Array.isArray(value) &&
              value.every((item) => typeof item === 'string')
            ),
        )
      )
        return hooks.fail('python-function-arguments-not-resolved');
      if (!hooks.remember(target.model.path)) return UNKNOWN;
      hooks.expanded();
      active.add(target.binding);
      frames.push(new Map(shape.parameters.map((parameter, index) => [parameter, values[index]])));
      try {
        return callback(shape);
      } finally {
        frames.pop();
        active.delete(target.binding);
      }
    } finally {
      depth--;
    }
  }
  return {
    expand,
    hasFrames: () => frames.length > 0,
    parameter(binding) {
      const frame = frames.findLast((candidate) => candidate.has(binding));
      return frame ? frame.get(binding) : UNKNOWN;
    },
  };
}

/** Check values supported by Python's bounded primitive grammar. @param {unknown} value @returns {boolean} Whether no mutable or callable value is present. @since v0.15.1 */
function isPythonPrimitive(value) {
  return typeof value === 'string' || typeof value === 'boolean' || value === null;
}

module.exports = { pythonFunctionShape, createPythonFunctions, isPythonPrimitive };
