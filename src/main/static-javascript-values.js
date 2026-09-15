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
const LOCAL_FUNCTION = Object.freeze({ kind: 'local-function' });
const NODE_MODULES = new Set(['child_process', 'node:child_process']);
const VALUE_STEPS = 8192;

/** Resolve only fixed imports, immutable strings and inline arguments. @param {object} index @param {string} mode @param {Set<string>} issues @returns {object} Bounded value resolver and mutation state. @since v0.15.1 */
function createValues(index, mode, issues) {
  let steps = 0;
  const resolving = new Set();
  const state = { moduleMutated: false, loaderMutated: false };
  const method = (name) =>
    METHODS.has(name) && !state.moduleMutated ? { kind: 'method', name } : UNKNOWN;
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
    if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')
      return LOCAL_FUNCTION;
    if (node.type === 'Identifier') {
      const binding = lookup(index.scopes.get(node), node.name);
      if (!binding) return UNKNOWN;
      if (binding.mutated) {
        issues.add('javascript-mutation-not-resolved');
        return UNKNOWN;
      }
      if (binding.kind === 'local-function') return LOCAL_FUNCTION;
      if (binding.kind === 'import') {
        if (!NODE_MODULES.has(binding.source)) {
          issues.add('javascript-module-not-resolved');
          return UNKNOWN;
        }
        return binding.imported === '*'
          ? state.moduleMutated
            ? UNKNOWN
            : MODULE
          : method(binding.imported);
      }
      if (binding.kind !== 'const' || resolving.has(binding)) return UNKNOWN;
      resolving.add(binding);
      let result = next(binding.init);
      resolving.delete(binding);
      if (binding.key !== null) result = result === MODULE ? method(binding.key) : UNKNOWN;
      if (Array.isArray(result) || result instanceof Map) {
        issues.add('javascript-mutable-binding-not-resolved');
        return UNKNOWN;
      }
      return result;
    }
    if (node.type === 'CallExpression' && loader(node.callee)) {
      if (node.arguments.length === 1 && NODE_MODULES.has(next(node.arguments[0])))
        return state.moduleMutated ? UNKNOWN : MODULE;
      issues.add('javascript-module-not-resolved');
      return UNKNOWN;
    }
    if (node.type === 'MemberExpression' && !node.optional) {
      const target = next(node.object);
      const key = node.computed ? next(node.property) : node.property.name;
      return target === MODULE ? method(key) : UNKNOWN;
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
  return { read, loader, state, isModule: (value) => value === MODULE };
}

module.exports = { createValues, UNKNOWN, VALUE_STEPS };
