'use strict';

const { lookup } = require('./static-javascript-scope');
const { COMMAND_CHARS, COMMAND_TOKENS } = require('./static-command-parser');
const UNKNOWN = Symbol('unknown');
const MODULE = Object.freeze({ kind: 'module' });
const METHODS = new Set([
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'spawn',
  'spawnSync',
  'fork',
]);
const NODE_MODULES = new Set(['child_process', 'node:child_process']);
const VALUE_STEPS = 8192;

/** Resolve bounded immutable values and optional snapshot associations. @param {object} index @param {string} mode @param {Set<string>} issues @param {object} [hooks] Snapshot and function hooks. @returns {object} Bounded value resolver and mutation state. @since v0.15.1 */
function createValues(index, mode, issues, hooks = {}) {
  let steps = 0;
  let parameters = new Map();
  let paths = new Set();
  const resolving = new Set();
  const state = { moduleMutated: false, loaderMutated: false };
  const method = (name) =>
    METHODS.has(name) && !state.moduleMutated ? { kind: 'method', name } : UNKNOWN;
  function imported(source, key) {
    if (state.moduleMutated || !hooks.importValue) {
      issues.add('javascript-module-not-resolved');
      return UNKNOWN;
    }
    const result = hooks.importValue(source, key);
    result.paths?.forEach((path) => paths.add(path));
    return result.value;
  }
  function member(target, key) {
    if (target === MODULE) return method(key);
    if (!state.moduleMutated && target?.kind === 'javascript-module') {
      const result = hooks.memberValue(target, key);
      result.paths?.forEach((path) => paths.add(path));
      return result.value;
    }
    return UNKNOWN;
  }
  const localFunction = (node) => ({ kind: 'local-function', node, owner: hooks.owner });
  function loader(node) {
    return (
      mode === 'commonjs' &&
      !state.loaderMutated &&
      node?.type === 'Identifier' &&
      node.name === 'require' &&
      !lookup(index.scopes.get(node), 'require')
    );
  }
  function read(node, depth = 0) {
    if (!node) return UNKNOWN;
    if (++steps > VALUE_STEPS || depth > 64) {
      issues.add('javascript-value-limit');
      return UNKNOWN;
    }
    const next = (child) => read(child, depth + 1);
    if (node.type === 'Literal') {
      if (typeof node.value === 'string' && node.value.length > COMMAND_CHARS) {
        issues.add('javascript-value-limit');
        return UNKNOWN;
      }
      return node.value === null || ['string', 'boolean', 'number'].includes(typeof node.value)
        ? node.value
        : UNKNOWN;
    }
    if (
      ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    )
      return localFunction(node);
    if (node.type === 'Identifier') {
      const binding = lookup(index.scopes.get(node), node.name);
      if (!binding) return UNKNOWN;
      if (binding.mutated) {
        issues.add('javascript-mutation-not-resolved');
        return UNKNOWN;
      }
      if (binding.kind === 'local-function') return localFunction(binding.node);
      if (binding.kind === 'parameter')
        return parameters.has(binding) ? parameters.get(binding) : UNKNOWN;
      if (binding.kind === 'import') {
        if (!NODE_MODULES.has(binding.source)) {
          return imported(binding.source, binding.imported);
        }
        return ['*', 'default'].includes(binding.imported)
          ? state.moduleMutated
            ? UNKNOWN
            : MODULE
          : method(binding.imported);
      }
      if (binding.kind !== 'const' || resolving.has(binding)) return UNKNOWN;
      resolving.add(binding);
      let result = next(binding.init);
      resolving.delete(binding);
      if (binding.key !== null) result = member(result, binding.key);
      if (Array.isArray(result) || result instanceof Map) {
        issues.add('javascript-mutable-binding-not-resolved');
        return UNKNOWN;
      }
      return result;
    }
    if (node.type === 'CallExpression' && loader(node.callee)) {
      if (node.arguments.length === 1) {
        const readSource = () => next(node.arguments[0]);
        const source = hooks.moduleSource ? hooks.moduleSource(readSource) : readSource();
        if (NODE_MODULES.has(source)) return state.moduleMutated ? UNKNOWN : MODULE;
        if (typeof source === 'string') return imported(source, '*');
      }
      issues.add('javascript-module-not-resolved');
      return UNKNOWN;
    }
    if (node.type === 'CallExpression' && hooks.callValue) return hooks.callValue(node);
    if (node.type === 'MemberExpression' && !node.optional) {
      const target = next(node.object);
      const key = node.computed ? next(node.property) : node.property.name;
      return member(target, key);
    }
    if (node.type === 'BinaryExpression' && node.operator === '+') {
      const left = next(node.left),
        right = next(node.right);
      if (typeof left !== 'string' || typeof right !== 'string') return UNKNOWN;
      if (left.length + right.length > COMMAND_CHARS) {
        issues.add('javascript-value-limit');
        return UNKNOWN;
      }
      return left + right;
    }
    if (node.type === 'TemplateLiteral') {
      let result = '';
      for (let i = 0; i < node.quasis.length; i++) {
        const value = i < node.expressions.length ? next(node.expressions[i]) : '';
        if (typeof value !== 'string' || typeof node.quasis[i].value.cooked !== 'string')
          return UNKNOWN;
        if (result.length + node.quasis[i].value.cooked.length + value.length > COMMAND_CHARS) {
          issues.add('javascript-value-limit');
          return UNKNOWN;
        }
        result += node.quasis[i].value.cooked + value;
      }
      return result;
    }
    if (node.type === 'ArrayExpression') {
      if (node.elements.length >= COMMAND_TOKENS) {
        issues.add('javascript-value-limit');
        return UNKNOWN;
      }
      const values = node.elements.map(next);
      return values.includes(UNKNOWN) ? UNKNOWN : values;
    }
    if (node.type === 'ObjectExpression') {
      const result = new Map();
      for (const property of node.properties) {
        if (property.type !== 'Property' || property.kind !== 'init' || property.method)
          return UNKNOWN;
        const key = property.computed
          ? next(property.key)
          : (property.key.name ?? property.key.value);
        if (typeof key !== 'string' || key === '__proto__') return UNKNOWN;
        result.set(key, next(property.value));
      }
      return result;
    }
    return UNKNOWN;
  }
  function capture(callback, bindings = parameters) {
    const previousPaths = paths;
    const previousParameters = parameters;
    paths = new Set();
    parameters = bindings;
    try {
      return { value: callback(), paths: [...paths] };
    } finally {
      paths = previousPaths;
      parameters = previousParameters;
    }
  }
  return {
    read,
    loader,
    state,
    capture,
    isModule: (value) => value === MODULE || value?.kind === 'javascript-module',
  };
}

module.exports = { createValues, UNKNOWN, VALUE_STEPS };
