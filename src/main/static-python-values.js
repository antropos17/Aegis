'use strict';

const { COMMAND_CHARS, COMMAND_TOKENS } = require('./static-command-parser');
const { readPythonString } = require('./static-python-string');
const { lookupPython } = require('./static-python-scope');
const UNKNOWN = Symbol('unknown-python-value');
const PYTHON_VALUE_STEPS = 8192;
const METHODS = new Set([
  'subprocess.run',
  'subprocess.Popen',
  'subprocess.call',
  'subprocess.check_call',
  'subprocess.check_output',
  'subprocess.getoutput',
  'subprocess.getstatusoutput',
  'os.system',
  'os.popen',
]);

/** Resolve a bounded subset of Python values without evaluating expressions. @param {object} parsed @param {object} index @param {Set<string>} issues @returns {object} Value reader and mutation state. @since v0.15.1 */
function createPythonValues(parsed, index, issues) {
  let steps = 0;
  const resolving = new Set();
  const state = { modulesInvalid: false };
  const method = (name) =>
    METHODS.has(name) && !state.modulesInvalid ? { kind: 'method', name } : UNKNOWN;
  function read(node, depth = 0) {
    if (!node) return UNKNOWN;
    if (++steps > PYTHON_VALUE_STEPS || depth > 64) {
      issues.add('python-value-limit');
      return UNKNOWN;
    }
    const next = (child) => read(child, depth + 1);
    if (node.type === 'String') {
      const result = readPythonString(parsed.source(node));
      if (result.issue) {
        issues.add(result.issue);
        return UNKNOWN;
      }
      return result.value;
    }
    if (node.type === 'Boolean') return parsed.source(node) === 'True';
    if (node.type === 'None') return null;
    if (node.type === 'VariableName') {
      const scope = index.scopes.get(node);
      const binding = lookupPython(scope, parsed.source(node));
      if (!binding) return UNKNOWN;
      if (binding.mutated) {
        issues.add('python-binding-not-resolved');
        return UNKNOWN;
      }
      if (binding.scope === scope && binding.from > node.from) return UNKNOWN;
      if (binding.kind === 'import') {
        if (state.modulesInvalid || !['os', 'subprocess'].includes(binding.module)) return UNKNOWN;
        return binding.method
          ? method(binding.module + '.' + binding.method)
          : { kind: 'module', name: binding.module };
      }
      if (binding.kind !== 'assignment' || resolving.has(binding)) return UNKNOWN;
      resolving.add(binding);
      const value = next(binding.init);
      resolving.delete(binding);
      if (Array.isArray(value)) {
        issues.add('python-mutable-binding-not-resolved');
        return UNKNOWN;
      }
      return value;
    }
    if (
      node.type === 'MemberExpression' &&
      node.children.length === 3 &&
      node.children[1].type === '.'
    ) {
      const target = next(node.children[0]);
      return target?.kind === 'module'
        ? method(target.name + '.' + parsed.identifier(node.children[2]))
        : UNKNOWN;
    }
    if (node.type === 'ParenthesizedExpression' && node.children.length === 3)
      return next(node.children[1]);
    if (
      node.type === 'BinaryExpression' &&
      node.children.length === 3 &&
      parsed.source(node.children[1]) === '+'
    ) {
      const left = next(node.children[0]),
        right = next(node.children[2]);
      if (typeof left !== 'string' || typeof right !== 'string') return UNKNOWN;
      if (left.length + right.length > COMMAND_CHARS) {
        issues.add('python-value-limit');
        return UNKNOWN;
      }
      return left + right;
    }
    if (node.type === 'ContinuedString') {
      let result = '';
      for (const child of node.children) {
        if (child.type === 'Comment') continue;
        const value = next(child);
        if (typeof value !== 'string') return UNKNOWN;
        if (result.length + value.length > COMMAND_CHARS) {
          issues.add('python-value-limit');
          return UNKNOWN;
        }
        result += value;
      }
      return result;
    }
    if (['ArrayExpression', 'TupleExpression'].includes(node.type)) {
      const elements = node.children
        .slice(1, -1)
        .filter((child) => child.type !== ',' && child.type !== 'Comment');
      if (elements.length >= COMMAND_TOKENS) {
        issues.add('python-value-limit');
        return UNKNOWN;
      }
      const values = elements.map((child) => read(child, depth + 1));
      return values.includes(UNKNOWN) ? UNKNOWN : values;
    }
    return UNKNOWN;
  }
  return { read, state };
}

module.exports = { createPythonValues, UNKNOWN, PYTHON_VALUE_STEPS };
