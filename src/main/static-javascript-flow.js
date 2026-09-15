'use strict';

const { inspectJavaScriptInvocation } = require('./static-javascript-invocation');
const { lookup } = require('./static-javascript-scope');
const { UNKNOWN } = require('./static-javascript-values');

function wrapperBody(node) {
  if (
    !node ||
    node.async ||
    node.generator ||
    node.params.some((parameter) => parameter.type !== 'Identifier')
  )
    return null;
  if (node.body.type === 'CallExpression') return { declarations: [], call: node.body };
  if (node.body.type !== 'BlockStatement') return null;
  const statements = node.body.body.filter((statement) => !statement.directive);
  const tail = statements.at(-1);
  const call = tail?.type === 'ReturnStatement' ? tail.argument : tail?.expression;
  if (call?.type !== 'CallExpression') return null;
  const declarations = statements.slice(0, -1);
  if (
    declarations.some(
      (statement) =>
        statement.type !== 'VariableDeclaration' ||
        statement.kind !== 'const' ||
        statement.declarations.some((declaration) => declaration.id.type !== 'Identifier'),
    )
  )
    return null;
  return { declarations: declarations.flatMap((statement) => statement.declarations), call };
}

/** Inspect bounded direct wrappers using literal positional arguments. @param {object|undefined} catalog @param {Set<string>} issues @returns {object} Per-entry call inspector. @since v0.15.1 */
function createJavaScriptFlow(catalog, issues) {
  const limits = catalog?.limits ?? { flowDepth: 8, flowCalls: 256 };
  let calls = 0;
  const failure = (issue) => {
    issues.add(issue);
    return { rules: [], commands: 0 };
  };

  function inspect(root, entry) {
    const paths = new Set([root.path]);
    const active = new Set();
    let expanded = false;
    function capture(model, callback, bindings) {
      paths.add(model.path);
      const captured = model.values.capture(callback, bindings);
      captured.paths.forEach((path) => paths.add(path));
      return captured.value;
    }
    function visit(model, node, bindings, depth) {
      const target = capture(model, () => model.values.read(node.callee), bindings);
      if (target?.kind === 'method') {
        const result = capture(
          model,
          () => inspectJavaScriptInvocation(target.name, node, model.values.read),
          bindings,
        );
        result.issues.forEach((issue) => issues.add(issue));
        return {
          rules: result.rules,
          commands: 1,
          sink: { path: model.path, line: node.loc.start.line },
        };
      }
      if (target?.kind !== 'local-function') return failure('javascript-call-target-not-resolved');
      if (++calls > limits.flowCalls) return failure('javascript-flow-call-limit');
      if (catalog && !catalog.take()) return failure('flow-work-limit');
      if (depth >= limits.flowDepth) return failure('javascript-flow-depth-limit');
      if (active.has(target.node)) return failure('javascript-flow-cycle');
      const body = wrapperBody(target.node);
      if (
        !body ||
        !target.owner ||
        node.optional ||
        node.arguments.some((argument) => argument.type === 'SpreadElement') ||
        node.arguments.length !== target.node.params.length
      )
        return failure('javascript-wrapper-not-resolved');
      const arguments_ = capture(
        model,
        () => node.arguments.map((argument) => model.values.read(argument)),
        bindings,
      );
      if (
        arguments_.some(
          (value) => value !== null && !['string', 'boolean', 'number'].includes(typeof value),
        )
      )
        return failure('javascript-flow-argument-not-resolved');
      const nextBindings = new Map();
      target.node.params.forEach((parameter, index) => {
        nextBindings.set(
          lookup(target.owner.index.scopes.get(parameter), parameter.name),
          arguments_[index],
        );
      });
      const valid = capture(
        target.owner,
        () =>
          body.declarations.every((declaration) => {
            const value = target.owner.values.read(declaration.init);
            return (
              value !== UNKNOWN &&
              !Array.isArray(value) &&
              !(value instanceof Map) &&
              value?.kind !== 'local-function'
            );
          }),
        nextBindings,
      );
      if (!valid) return failure('javascript-wrapper-not-resolved');
      active.add(target.node);
      expanded = true;
      issues.add('javascript-control-flow-not-evaluated');
      try {
        return visit(target.owner, body.call, nextBindings, depth + 1);
      } finally {
        active.delete(target.node);
      }
    }
    const result = visit(root, entry, new Map(), 0);
    if (expanded || paths.size > 1) result.flow = { sink: result.sink, paths: [...paths].sort() };
    return result;
  }
  return { inspect };
}

module.exports = { createJavaScriptFlow };
