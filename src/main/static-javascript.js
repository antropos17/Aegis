'use strict';

const { parseJavaScript } = require('./static-javascript-ast');
const { indexScopes, lookup, children, FUNCTIONS } = require('./static-javascript-scope');
const { createValues, UNKNOWN, VALUE_STEPS } = require('./static-javascript-values');
const { createJavaScriptModules } = require('./static-javascript-modules');
const { createJavaScriptFlow } = require('./static-javascript-flow');
const { COMMANDS_PER_FILE } = require('./static-config-analysis');

function invalidateMutations(index, values, issues) {
  let escapeSteps = 0;
  function carriesModule(value) {
    if (values.isModule(value)) return true;
    if (Array.isArray(value)) return value.some(carriesModule);
    if (value instanceof Map) return [...value.values()].some(carriesModule);
    return false;
  }
  function carriesModuleSyntax(node) {
    const seen = new Set();
    function visit(current, depth) {
      if (!current) return false;
      if (++escapeSteps > VALUE_STEPS || depth > 64) {
        issues.add('javascript-value-limit');
        return true;
      }
      const value = values.read(current);
      if (carriesModule(value)) return true;
      const next = (child) => visit(child, depth + 1);
      if (current.type === 'Identifier' && value === UNKNOWN) {
        const binding = lookup(index.scopes.get(current), current.name);
        if (binding?.kind === 'const' && !seen.has(binding)) {
          seen.add(binding);
          return next(binding.init);
        }
      }
      if (['ArrayExpression', 'ObjectExpression', 'LogicalExpression'].includes(current.type))
        return children(current).some(next);
      if (current.type === 'Property') return next(current.value);
      if (['SpreadElement', 'AwaitExpression'].includes(current.type))
        return next(current.argument);
      if (current.type === 'ConditionalExpression')
        return next(current.consequent) || next(current.alternate);
      if (current.type === 'SequenceExpression') return next(current.expressions.at(-1));
      return false;
    }
    return visit(node, 0);
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
      if (node.arguments.some(carriesModuleSyntax)) {
        issues.add('javascript-module-escape-not-resolved');
        values.state.moduleMutated = true;
      }
    }
    if (
      (['ObjectExpression', 'ArrayExpression'].includes(node.type) && carriesModuleSyntax(node)) ||
      (['ReturnStatement', 'YieldExpression'].includes(node.type) &&
        carriesModuleSyntax(node.argument)) ||
      (node.type === 'ArrowFunctionExpression' &&
        node.body.type !== 'BlockStatement' &&
        carriesModuleSyntax(node.body)) ||
      (node.type === 'AssignmentExpression' &&
        node.left.type === 'MemberExpression' &&
        carriesModuleSyntax(node.right)) ||
      (node.type === 'VariableDeclaration' &&
        node.kind !== 'const' &&
        node.declarations.some((declaration) => carriesModuleSyntax(declaration.init)))
    ) {
      issues.add('javascript-module-escape-not-resolved');
      values.state.moduleMutated = true;
    }
  }
}

/** Inspect bounded JavaScript and admitted snapshot call relations without execution. @param {string} text @param {string} name @param {object} [catalog] Read-only admitted source catalog. @returns {object} Fixed findings and coverage gaps. @since v0.15.1 */
function analyzeJavaScript(text, name, catalog) {
  const findings = [];
  const issues = new Set();
  let commands = 0;
  const modules = createJavaScriptModules(catalog, issues, (model) => {
    const result = parseJavaScript(model.text, model.path);
    if (result.issue) {
      issues.add(result.issue);
      return;
    }
    model.ast = result.ast;
    model.index = indexScopes(result.ast, result.mode);
    model.values = createValues(model.index, result.mode, issues, {
      owner: model,
      importValue: (source, key) => modules.resolve(model, source, key),
      memberValue: modules.member,
    });
    invalidateMutations(model.index, model.values, issues);
  });
  const root = modules.add(name, text);
  if (!root?.index) return { findings, issues: [...issues].sort(), commands };
  const { index, values } = root;
  const flow = createJavaScriptFlow(catalog, issues);
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
    if (node.type === 'ImportExpression') issues.add('javascript-module-not-resolved');
    if (
      node.source &&
      ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) &&
      !['child_process', 'node:child_process'].includes(node.source.value)
    )
      modules.resolve(root, node.source.value, '*');
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
    if (commands >= COMMANDS_PER_FILE) {
      issues.add('command-count-limit');
      break;
    }
    const analysis = flow.inspect(root, node);
    commands += analysis.commands;
    analysis.rules.forEach((ruleId) =>
      findings.push({
        ruleId,
        line: node.loc.start.line,
        context: analysis.flow ? 'javascript-command-flow' : 'javascript-command',
        ...(analysis.flow ? { flow: analysis.flow } : {}),
      }),
    );
  }
  return { findings, issues: [...issues].sort(), commands };
}

module.exports = { analyzeJavaScript };
