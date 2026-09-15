'use strict';

const { parsePython } = require('./static-python-tree');
const { inspectPythonInvocation } = require('./static-python-invocation');
const { createPythonValues } = require('./static-python-values');
const { indexPythonScopes, lookupPython } = require('./static-python-scope');
const { COMMANDS_PER_FILE } = require('./static-config-analysis');

function invalidatePythonMutations(parsed, index, values, issues) {
  const carriesModule = (value) =>
    value?.kind === 'module' || (Array.isArray(value) && value.some(carriesModule));
  for (let target of index.mutations) {
    while (target.type === 'MemberExpression') target = target.children[0];
    if (values.read(target)?.kind === 'module') values.state.modulesInvalid = true;
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
      if (node.children[1]?.children.some((child) => carriesModule(values.read(child)))) {
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
      node.children.some((child) => carriesModule(values.read(child)))
    ) {
      values.state.modulesInvalid = true;
      issues.add('python-module-escape-not-resolved');
    }
    if (
      node.type === 'AssignStatement' &&
      node.children[0].type === 'MemberExpression' &&
      carriesModule(values.read(node.children.at(-1)))
    ) {
      values.state.modulesInvalid = true;
      issues.add('python-module-escape-not-resolved');
    }
  }
}

/** Review literal Python process calls without loading the source. @param {string} text @returns {object} Fixed findings and coverage issues. @since v0.15.1 */
function analyzePython(text) {
  const parsed = parsePython(text);
  const findings = [];
  const issues = new Set();
  let commands = 0;
  if (parsed.issue) return { findings, issues: [parsed.issue], commands };
  const { source } = parsed;
  const index = indexPythonScopes(parsed, issues);
  const values = createPythonValues(parsed, index, issues);
  const { read } = values;
  invalidatePythonMutations(parsed, index, values, issues);
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
    const target = read(node.children[0]);
    if (target?.kind !== 'method') {
      issues.add('python-call-target-not-resolved');
      continue;
    }
    if (commands >= COMMANDS_PER_FILE) {
      issues.add('command-count-limit');
      break;
    }
    commands++;
    const analysis = inspectPythonInvocation(target.name, node, read, source);
    analysis.rules.forEach((ruleId) =>
      findings.push({ ruleId, line: parsed.lineAt(node.from), context: 'python-command' }),
    );
    analysis.issues.forEach((reason) => issues.add(reason));
  }
  return { findings, issues: [...issues].sort(), commands };
}

module.exports = { analyzePython };
