'use strict';

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** Enumerate syntax children, excluding parser metadata. @param {object} node @returns {object[]} AST children. @since v0.15.1 */
function children(node) {
  return Object.values(node).flatMap((value) =>
    (Array.isArray(value) ? value : [value]).filter(
      (child) => child && typeof child.type === 'string',
    ),
  );
}

/** Index lexical bindings before resolving calls, including hoisted shadows. @param {object} ast Bounded parsed tree. @param {string} mode Parser source mode. @returns {object} Scope and node indexes. @since v0.15.1 */
function indexScopes(ast, mode) {
  const scopes = new WeakMap();
  const nodes = [];
  const blockFunctions = [];
  const root = { parent: null, kind: 'function', bindings: new Map() };
  function bind(pattern, scope, description, key = null) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') {
      const previous = scope.bindings.get(pattern.name);
      scope.bindings.set(pattern.name, { ...description, scope, key, mutated: Boolean(previous) });
    } else if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties) {
        if (
          property.type === 'Property' &&
          !property.computed &&
          property.value.type === 'Identifier'
        )
          bind(property.value, scope, description, property.key.name ?? property.key.value);
        else
          bind(property.type === 'RestElement' ? property.argument : property.value, scope, {
            kind: 'unknown',
          });
      }
    } else if (pattern.type === 'ArrayPattern') {
      pattern.elements.forEach((element) => bind(element, scope, { kind: 'unknown' }));
    } else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope, { kind: 'unknown' });
    else if (pattern.type === 'RestElement') bind(pattern.argument, scope, { kind: 'unknown' });
  }
  function walk(node, parent, parentNode) {
    let scope = parent;
    if (node.type === 'FunctionDeclaration') {
      bind(node.id, parent, { kind: 'local-function', node });
      if (mode === 'commonjs' && parent.kind === 'block' && !parent.functionBody) {
        let owner = parent;
        while (owner.parent && owner.kind !== 'function') owner = owner.parent;
        blockFunctions.push({ owner, name: node.id.name });
      }
    }
    if (node.type === 'ClassDeclaration') bind(node.id, parent, { kind: 'unknown' });
    if (FUNCTIONS.has(node.type)) {
      scope = { parent, kind: 'function', bindings: new Map() };
      if (node.type === 'FunctionExpression' && node.id)
        bind(node.id, scope, { kind: 'local-function', node });
      node.params.forEach((parameter) => bind(parameter, scope, { kind: 'parameter' }));
    } else if (
      [
        'BlockStatement',
        'CatchClause',
        'ForStatement',
        'ForInStatement',
        'ForOfStatement',
        'SwitchStatement',
        'ClassExpression',
        'StaticBlock',
        'WithStatement',
      ].includes(node.type)
    ) {
      scope = {
        parent,
        kind: 'block',
        bindings: new Map(),
        dynamic: node.type === 'WithStatement',
      };
      scope.functionBody = node.type === 'BlockStatement' && FUNCTIONS.has(parentNode?.type);
      if (node.type === 'CatchClause') bind(node.param, scope, { kind: 'unknown' });
      if (node.type === 'ClassExpression') bind(node.id, scope, { kind: 'unknown' });
    }
    scopes.set(node, scope);
    nodes.push(node);
    if (node.type === 'VariableDeclaration') {
      let owner = scope;
      if (node.kind === 'var')
        while (owner.parent && owner.kind !== 'function') owner = owner.parent;
      for (const declaration of node.declarations)
        bind(declaration.id, owner, { kind: node.kind, init: declaration.init });
    }
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers)
        bind(specifier.local, scope, {
          kind: 'import',
          source: node.source.value,
          imported:
            specifier.type === 'ImportSpecifier'
              ? (specifier.imported.name ?? specifier.imported.value)
              : specifier.type === 'ImportDefaultSpecifier'
                ? 'default'
                : '*',
        });
    }
    children(node).forEach((child) => walk(child, scope, node));
  }
  walk(ast, root);
  // CommonJS Annex B block functions can create function-scoped bindings.
  // Strict-mode eligibility and branch execution are deliberately not resolved.
  for (const { owner, name } of blockFunctions) {
    if (!['const', 'let', 'import'].includes(owner.bindings.get(name)?.kind))
      owner.bindings.set(name, { kind: 'unknown' });
  }
  return { scopes, nodes, root };
}

/** Find a lexical declaration; dynamic with-scopes block global assumptions. @param {object} scope @param {string} name @returns {object|null} Binding or absent global. @since v0.15.1 */
function lookup(scope, name) {
  for (let current = scope; current; current = current.parent) {
    if (current.bindings.has(name)) return current.bindings.get(name);
    if (current.dynamic) return { kind: 'unknown' };
  }
  return null;
}

module.exports = { indexScopes, lookup, children, FUNCTIONS };
