'use strict';

const { UNKNOWN } = require('./static-javascript-values');

/** Link syntax exports only within the admitted in-memory source catalog. @param {object|undefined} catalog @param {Set<string>} issues @param {function} prepare Model initializer. @returns {object} Bounded snapshot module lookup. @since v0.15.1 */
function createJavaScriptModules(catalog, issues, prepare) {
  const cache = new Map();
  const resolving = new Set();
  const limit = catalog?.limits ?? { flowDepth: 8, flowModules: 32 };
  let depth = 0;
  let preparingDepth = 0;
  const missing = (issue) => {
    issues.add(issue);
    return { value: UNKNOWN, paths: [] };
  };

  function add(path, text) {
    if (cache.has(path)) return cache.get(path);
    if (cache.size >= limit.flowModules) {
      issues.add('javascript-flow-module-limit');
      return null;
    }
    if (preparingDepth >= limit.flowDepth) {
      issues.add('javascript-flow-depth-limit');
      return null;
    }
    const model = { path, text, preparing: true, exports: new Map() };
    cache.set(path, model);
    preparingDepth++;
    try {
      prepare(model);
    } finally {
      preparingDepth--;
    }
    if (model.index) {
      const reference = (name) => {
        const node = { type: 'Identifier', name };
        model.index.scopes.set(node, model.index.root);
        return node;
      };
      for (const node of model.ast.body) {
        if (node.type === 'ExportDefaultDeclaration') {
          const value = node.declaration;
          model.exports.set('default', {
            node:
              value.type === 'FunctionDeclaration' && value.id ? reference(value.id.name) : value,
          });
        } else if (node.type === 'ExportNamedDeclaration') {
          const declaration = node.declaration;
          if (declaration?.type === 'VariableDeclaration') {
            for (const item of declaration.declarations)
              if (item.id.type === 'Identifier') model.exports.set(item.id.name, { node: item.id });
          } else if (declaration?.id) {
            model.exports.set(declaration.id.name, { node: reference(declaration.id.name) });
          }
          for (const specifier of node.specifiers) {
            model.exports.set(specifier.exported.name ?? specifier.exported.value, {
              node: specifier.local,
              source: node.source?.value,
              imported: specifier.local.name ?? specifier.local.value,
            });
          }
        } else if (node.type === 'ExportAllDeclaration') {
          if (node.exported)
            model.exports.set(node.exported.name ?? node.exported.value, {
              source: node.source.value,
              imported: '*',
            });
          else issues.add('javascript-flow-star-export-not-resolved');
        }
      }
    }
    model.preparing = false;
    return model;
  }

  function exported(model, key) {
    if (model.preparing) return missing('javascript-flow-cycle');
    if (!model.index) return missing('javascript-module-not-resolved');
    if (key === '*') return { value: { kind: 'javascript-module', model }, paths: [model.path] };
    if (typeof key !== 'string') return missing('javascript-flow-export-not-resolved');
    const description = model.exports.get(key);
    if (!description) return missing('javascript-flow-export-not-resolved');
    const token = JSON.stringify([model.path, key]);
    if (resolving.has(token)) return missing('javascript-flow-cycle');
    if (++depth > limit.flowDepth) {
      depth--;
      return missing('javascript-flow-depth-limit');
    }
    resolving.add(token);
    try {
      const result = description.source
        ? resolve(model, description.source, description.imported)
        : model.values.capture(() => model.values.read(description.node), new Map());
      if (Array.isArray(result.value) || result.value instanceof Map)
        return missing('javascript-mutable-binding-not-resolved');
      if (result.value === UNKNOWN) issues.add('javascript-flow-export-not-resolved');
      return { value: result.value, paths: [...new Set([model.path, ...result.paths])] };
    } finally {
      resolving.delete(token);
      depth--;
    }
  }

  function resolve(model, source, imported) {
    if (!catalog) return missing('javascript-module-not-resolved');
    if (!catalog.take()) return missing('flow-work-limit');
    const record = catalog.resolve(model.path, source, 'javascript');
    if (!record || record.issue) {
      issues.add('javascript-module-not-resolved');
      return missing(record?.issue ?? 'javascript-module-not-resolved');
    }
    if (depth >= limit.flowDepth) return missing('javascript-flow-depth-limit');
    const target = add(record.path, record.text);
    if (!target) return missing('javascript-flow-module-limit');
    issues.add('javascript-cross-file-effects-not-evaluated');
    return exported(target, imported);
  }

  return {
    add,
    resolve,
    member(namespace, key) {
      if (catalog && !catalog.take()) return missing('flow-work-limit');
      return exported(namespace.model, key);
    },
  };
}

module.exports = { createJavaScriptModules };
