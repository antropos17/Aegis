'use strict';

const { commaGroups } = require('./static-python-tree');
const MODULES = new Set(['subprocess', 'os']);
const OPAQUE = /^(?:ClassDefinition|LambdaExpression|TypeParamList|.*ComprehensionExpression)$/;

/** Pre-index Python bindings, including function-local assignments before use. @param {object} parsed @param {Set<string>} issues @returns {object} Lexical scopes and mutation targets. @since v0.15.1 */
function indexPythonScopes(parsed, issues) {
  const scopes = new WeakMap();
  const mutations = [];
  function bind(node, scope, description = { kind: 'unknown' }) {
    if (!node) return;
    if (node.type === 'VariableName') {
      const name = parsed.identifier(node);
      scope.bindings.set(name, {
        ...description,
        scope,
        from: node.from,
        mutated: scope.bindings.has(name),
      });
    } else if (
      ['TupleExpression', 'ArrayExpression', 'ParenthesizedExpression'].includes(node.type)
    ) {
      node.children.forEach((child) => bind(child, scope));
    } else if (node.type === 'MemberExpression') mutations.push(node);
  }
  function imports(node, scope) {
    const parts = node.children.filter((child) => !['Comment', '(', ')'].includes(child.type));
    const separator = parts.findIndex((child) => child.type === 'import');
    const from = parts[0].type === 'from';
    const module = from ? parts.slice(1, separator).map(parsed.identifier).join('') : null;
    for (const group of commaGroups(parts.slice(separator + 1))) {
      const alias = group.findIndex((child) => child.type === 'as');
      const nameParts = alias < 0 ? group : group.slice(0, alias);
      const name = nameParts.map(parsed.identifier).join('');
      const local = alias < 0 ? nameParts[0] : group[alias + 1];
      if (name === '*') {
        scope.dynamic = true;
        issues.add('python-module-not-resolved');
        continue;
      }
      const selected = from ? module : name;
      if (!MODULES.has(selected)) issues.add('python-module-not-resolved');
      bind(local, scope, { kind: 'import', module: selected, method: from ? name : null });
    }
  }
  function walk(node, scope) {
    scopes.set(node, scope);
    if (node.type === 'FunctionDefinition') {
      bind(
        node.children.find((child) => child.type === 'VariableName'),
        scope,
      );
      const inner = { parent: scope, bindings: new Map(), dynamic: false, kind: 'function' };
      if (node.children.some((child) => child.type === 'TypeParamList')) {
        inner.dynamic = true;
        issues.add('python-scope-not-analyzed');
      }
      const params = node.children.find((child) => child.type === 'ParamList');
      for (const group of commaGroups(params?.children.slice(1, -1) ?? []))
        bind(
          group.find((child) => child.type === 'VariableName'),
          inner,
        );
      node.children.forEach((child) => walk(child, child.type === 'Body' ? inner : scope));
      return;
    }
    if (OPAQUE.test(node.type)) {
      if (node.type === 'ClassDefinition')
        bind(
          node.children.find((child) => child.type === 'VariableName'),
          scope,
        );
      issues.add('python-scope-not-analyzed');
      scope = { parent: scope, bindings: new Map(), dynamic: true, kind: 'opaque' };
      scopes.set(node, scope);
    }
    if (node.type === 'ImportStatement') imports(node, scope);
    if (['ScopeStatement', 'MatchStatement', 'TypeDefinition'].includes(node.type)) {
      scope.dynamic = true;
      issues.add('python-scope-not-analyzed');
    }
    if (node.type === 'AssignStatement') {
      const parts = node.children.filter((child) => child.type !== 'Comment');
      const equals = parts.flatMap((child, index) => (child.type === 'AssignOp' ? [index] : []));
      const simple =
        equals.length === 1 &&
        equals[0] === 1 &&
        parts.length === 3 &&
        parts[0].type === 'VariableName';
      if (simple) bind(parts[0], scope, { kind: 'assignment', init: parts[2] });
      else
        (equals.length ? parts.slice(0, equals.at(-1)) : parts).forEach((child) =>
          bind(child, scope),
        );
    }
    if (['UpdateStatement', 'NamedExpression'].includes(node.type)) bind(node.children[0], scope);
    if (node.type === 'DeleteStatement')
      node.children.slice(1).forEach((child) => bind(child, scope));
    if (node.type === 'ForStatement') {
      const end = node.children.findIndex((child) => child.type === 'in');
      node.children.slice(1, end).forEach((child) => bind(child, scope));
    }
    if (['WithStatement', 'TryStatement'].includes(node.type))
      node.children.forEach((child, index) => {
        if (child.type === 'as') bind(node.children[index + 1], scope);
      });
    node.children.forEach((child) => walk(child, scope));
  }
  walk(parsed.root, { parent: null, bindings: new Map(), dynamic: false, kind: 'module' });
  return { scopes, mutations };
}

/** Resolve a name through lexical scopes; opaque constructs prevent assumptions. @param {object} scope @param {string} name @returns {object|null} Binding or absent global. @since v0.15.1 */
function lookupPython(scope, name) {
  name = name.normalize('NFKC');
  for (let current = scope; current; current = current.parent) {
    if (current.dynamic) return { kind: 'unknown' };
    if (current.bindings.has(name)) return current.bindings.get(name);
  }
  return null;
}

module.exports = { indexPythonScopes, lookupPython };
