'use strict';

const { parseJavaScript } = require('./static-javascript-ast');
const { inspectJavaScriptInvocation } = require('./static-javascript-invocation');
const { indexScopes, lookup, children, FUNCTIONS } = require('./static-javascript-scope');
const { createValues } = require('./static-javascript-values');
const { COMMANDS_PER_FILE } = require('./static-config-analysis');

function invalidateMutations(index, values, issues) {
  function carriesModule(value) {
    if (values.isModule(value)) return true;
    if (Array.isArray(value)) return value.some(carriesModule);
    if (value instanceof Map) return [...value.values()].some(carriesModule);
    return false;
  }
  function mutation(node) {
    if (!node) return;
    if (node.type === 'MemberExpression') {
      let target = node.object;
      while (target.type === 'MemberExpression') target = target.object;
      if (values.isModule(values.read(target))) values.state.moduleMutated = true;
      mutation(target);
    } else if (node.type === 'Identifier') {
      const binding = lookup(index.scopes.get(node), node.name);
      if (binding) binding.mutated = true;
      else if (node.name === 'require') values.state.loaderMutated = true;
    } else if (node.type === 'Property') mutation(node.value);
    else if (node.type === 'RestElement') mutation(node.argument);
    else if (node.type === 'AssignmentPattern') mutation(node.left);
    else if (['ObjectPattern', 'ArrayPattern'].includes(node.type)) {
      children(node).forEach(mutation);
    }
    issues.add('javascript-mutation-not-resolved');
  }
  for (const node of index.nodes) {
    if (node.type === 'AssignmentExpression') mutation(node.left);
    else if (
      node.type === 'UpdateExpression' ||
      (node.type === 'UnaryExpression' && node.operator === 'delete')
    )
      mutation(node.argument);
    else if (
      ['ForInStatement', 'ForOfStatement'].includes(node.type) &&
      node.left.type !== 'VariableDeclaration'
    )
      mutation(node.left);
    if (['CallExpression', 'NewExpression'].includes(node.type)) {
      if (
        node.callee.type === 'Identifier' &&
        ['eval', 'Function'].includes(node.callee.name) &&
        !lookup(index.scopes.get(node.callee), node.callee.name)
      ) {
        issues.add('javascript-dynamic-code-not-analyzed');
        values.state.moduleMutated = true;
        values.state.loaderMutated = true;
      }
      if (node.arguments.some((argument) => carriesModule(values.read(argument)))) {
        issues.add('javascript-module-escape-not-resolved');
        values.state.moduleMutated = true;
      }
    }
    if (
      ['ObjectExpression', 'ArrayExpression'].includes(node.type) &&
      carriesModule(values.read(node))
    ) {
      issues.add('javascript-module-escape-not-resolved');
      values.state.moduleMutated = true;
    }
  }
}

/** Inspect a bounded JavaScript command subset without loading the source. @param {string} text @param {string} name @returns {object} Fixed findings and coverage gaps. @since v0.15.1 */
function analyzeJavaScript(text, name) {
  const result = parseJavaScript(text, name);
  const findings = [];
  const issues = new Set();
  let commands = 0;
  if (result.issue) return { findings, issues: [result.issue], commands };
  const index = indexScopes(result.ast, result.mode);
  const values = createValues(index, result.mode, issues);
  invalidateMutations(index, values, issues);
  for (const node of index.nodes) {
    if (
      FUNCTIONS.has(node.type) ||
      [
        'IfStatement',
        'SwitchStatement',
        'TryStatement',
        'ForStatement',
        'ForInStatement',
        'ForOfStatement',
        'WhileStatement',
        'DoWhileStatement',
        'ConditionalExpression',
        'LogicalExpression',
        'WithStatement',
        'ReturnStatement',
        'ThrowStatement',
        'BreakStatement',
        'ContinueStatement',
      ].includes(node.type)
    )
      issues.add('javascript-control-flow-not-evaluated');
    if (
      node.type === 'ImportExpression' ||
      (node.source &&
        ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
          node.type,
        ) &&
        !['child_process', 'node:child_process'].includes(node.source.value))
    )
      issues.add('javascript-module-not-resolved');
    if (
      ['NewExpression', 'TaggedTemplateExpression', 'ClassDeclaration', 'ClassExpression'].includes(
        node.type,
      )
    )
      issues.add('javascript-construct-not-analyzed');
    if (node.type !== 'CallExpression') continue;
    if (values.loader(node.callee)) {
      values.read(node);
      continue;
    }
    const target = values.read(node.callee);
    if (target?.kind !== 'method') {
      issues.add('javascript-call-target-not-resolved');
      continue;
    }
    if (commands >= COMMANDS_PER_FILE) {
      issues.add('command-count-limit');
      break;
    }
    commands++;
    const analysis = inspectJavaScriptInvocation(target.name, node, values.read);
    analysis.rules.forEach((ruleId) =>
      findings.push({ ruleId, line: node.loc.start.line, context: 'javascript-command' }),
    );
    analysis.issues.forEach((issue) => issues.add(issue));
  }
  return { findings, issues: [...issues].sort(), commands };
}

module.exports = { analyzeJavaScript };
