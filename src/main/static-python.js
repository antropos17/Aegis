'use strict';

const { parsePython, commaGroups } = require('./static-python-tree');
const { createPythonValues, PYTHON_VALUE_STEPS } = require('./static-python-values');
const { indexPythonScopes, lookupPython } = require('./static-python-scope');
const { createPythonFlow, pythonWrapperShape } = require('./static-python-flow');

function createPythonEscapes(parsed, index, values, issues) {
  const carriesModule = (value) =>
    ['module', 'local-module', 'function'].includes(value?.kind) ||
    (Array.isArray(value) && value.some(carriesModule));
  const carriesImported = (value) =>
    value?.kind === 'import-symbol' || (Array.isArray(value) && value.some(carriesImported));
  const escapeCache = new WeakMap();
  const tracing = new WeakSet();
  let escapeSteps = 0;
  // Bit 1 tracks module/function references; bit 2 tracks unresolved import symbols.
  // Calls yield unknown values; their callee and arguments are examined separately.
  function escaped(node, depth = 0) {
    if (!node || tracing.has(node)) return 0;
    if (escapeCache.has(node)) return escapeCache.get(node);
    if (++escapeSteps > PYTHON_VALUE_STEPS || depth > 64) {
      values.state.modulesInvalid = true;
      issues.add('python-value-limit');
      return 3;
    }
    tracing.add(node);
    const value = values.read(node);
    let kinds = (carriesModule(value) ? 1 : 0) | (carriesImported(value) ? 2 : 0);
    const forwarding =
      [
        'ConditionalExpression',
        'ParenthesizedExpression',
        'NamedExpression',
        'ArrayExpression',
        'TupleExpression',
        'DictionaryExpression',
        'SetExpression',
        'MemberExpression',
      ].includes(node.type) ||
      (node.type === 'BinaryExpression' &&
        node.children.some((child) => ['and', 'or'].includes(child.type)));
    if (!kinds && forwarding) for (const child of node.children) kinds |= escaped(child, depth + 1);
    if (!kinds && node.type === 'VariableName') {
      const binding = lookupPython(index.scopes.get(node), parsed.identifier(node));
      if (binding?.kind === 'assignment' && !binding.mutated)
        kinds |= escaped(binding.init, depth + 1);
    }
    tracing.delete(node);
    escapeCache.set(node, kinds);
    return kinds;
  }
  return escaped;
}

function callArgumentNodes(node) {
  const args = node.children[1];
  if (args?.type !== 'ArgList') return [];
  return commaGroups(args.children.slice(1, -1)).flatMap((group) =>
    group.length === 3 && group[1].type === 'AssignOp' ? [group[2]] : group,
  );
}

function invalidatePythonMutations(parsed, index, values, issues) {
  values.state.flowInvalid = parsed.nodes.some((node) => node.type === 'ScopeStatement');
  const escaped = createPythonEscapes(parsed, index, values, issues);
  for (let target of index.mutations) {
    while (target.type === 'MemberExpression') target = target.children[0];
    if (escaped(target)) values.state.modulesInvalid = true;
    issues.add('python-mutation-not-resolved');
  }
  for (const node of parsed.nodes) {
    if (node.type === 'CallExpression') {
      const callee = node.children[0];
      if (
        callee.type === 'VariableName' &&
        ['exec', 'eval', 'compile', '__import__', 'globals', 'locals'].includes(
          parsed.identifier(callee),
        ) &&
        !lookupPython(index.scopes.get(callee), parsed.identifier(callee))
      ) {
        values.state.modulesInvalid = true;
        issues.add('python-dynamic-code-not-analyzed');
      }
      const target = values.read(callee);
      const known =
        ['method', 'import-symbol'].includes(target?.kind) ||
        (target?.kind === 'function' && pythonWrapperShape(target.model, target.binding)) ||
        (callee.type === 'MemberExpression' &&
          values.read(callee.children[0])?.kind === 'local-module');
      if (
        callArgumentNodes(node).some((child) => {
          const kinds = escaped(child);
          return kinds & 1 || (!known && kinds & 2);
        })
      ) {
        values.state.modulesInvalid = true;
        issues.add('python-module-escape-not-resolved');
      }
    }
    if (
      [
        'ArrayExpression',
        'TupleExpression',
        'DictionaryExpression',
        'SetExpression',
        'ReturnStatement',
      ].includes(node.type) &&
      node.children.some((child) => escaped(child))
    ) {
      values.state.modulesInvalid = true;
      issues.add('python-module-escape-not-resolved');
    }
    if (node.type === 'AssignStatement' && node.children[0].type === 'MemberExpression') {
      if (escaped(node.children.at(-1))) {
        values.state.modulesInvalid = true;
        issues.add('python-module-escape-not-resolved');
      }
    }
  }
}

/** Review Python process syntax and selected-source flow without loading code. @param {string} text @param {string} [name] Selected relative path. @param {object} [catalog] Read-only selected-source catalog. @returns {object} Fixed findings and coverage issues. @since v0.15.1 */
function analyzePython(text, name = '', catalog) {
  const issues = new Set();
  const flow = createPythonFlow(name, catalog, issues, (source, path, hooks) => {
    const parsed = parsePython(source);
    if (parsed.issue) {
      issues.add(parsed.issue);
      return { path, parsed };
    }
    const index = indexPythonScopes(parsed, issues);
    const model = { path, parsed, index, validating: true };
    model.values = createPythonValues(parsed, index, issues, hooks(model));
    invalidatePythonMutations(parsed, index, model.values, issues);
    model.validating = false;
    const escaped = createPythonEscapes(parsed, index, model.values, issues);
    model.escapesArguments = (call) => callArgumentNodes(call).some((node) => escaped(node));
    return model;
  });
  const model = flow.root(text);
  if (!model || model.parsed.issue) return flow.result();
  const { parsed } = model;
  for (const node of parsed.nodes) {
    if (
      [
        'FunctionDefinition',
        'IfStatement',
        'ForStatement',
        'WhileStatement',
        'TryStatement',
        'WithStatement',
        'MatchStatement',
        'ReturnStatement',
        'RaiseStatement',
        'ConditionalExpression',
      ].includes(node.type)
    )
      issues.add('python-control-flow-not-evaluated');
    if (
      node.type === 'BinaryExpression' &&
      node.children.some((child) => ['and', 'or'].includes(child.type))
    )
      issues.add('python-control-flow-not-evaluated');
    if (['FormatString', 'NamedExpression', 'AwaitExpression'].includes(node.type))
      issues.add('python-construct-not-analyzed');
    if (node.type !== 'CallExpression') continue;
    flow.inspect(model, node);
  }
  return flow.result();
}

module.exports = { analyzePython };
