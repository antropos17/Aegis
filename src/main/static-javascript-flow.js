'use strict';

const { inspectJavaScriptInvocation } = require('./static-javascript-invocation');
const { lookup } = require('./static-javascript-scope');
const { UNKNOWN } = require('./static-javascript-values');

function functionBody(node, returning) {
  if (
    !node ||
    node.async ||
    node.generator ||
    node.params.some((parameter) => parameter.type !== 'Identifier')
  )
    return null;
  if (node.body.type !== 'BlockStatement')
    return returning || node.body.type === 'CallExpression'
      ? { declarations: [], value: node.body }
      : null;
  const statements = node.body.body.filter((statement) => !statement.directive);
  const tail = statements.at(-1);
  const value = tail?.type === 'ReturnStatement' ? tail.argument : tail?.expression;
  if (returning ? tail?.type !== 'ReturnStatement' || !value : value?.type !== 'CallExpression')
    return null;
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
  return { declarations: declarations.flatMap((statement) => statement.declarations), value };
}

const primitive = (value) =>
  value === null || ['string', 'boolean', 'number'].includes(typeof value);

/** Inspect bounded command wrappers and primitive function results. @param {object|undefined} catalog @param {Set<string>} issues @returns {object} Per-entry call and return inspector. @since v0.15.1 */
function createJavaScriptFlow(catalog, issues) {
  const limits = catalog?.limits ?? { flowDepth: 8, flowCalls: 256 };
  let calls = 0;
  let context = null;
  const failure = (issue) => {
    issues.add(issue);
    return UNKNOWN;
  };
  function capture(model, callback, bindings) {
    context.paths.add(model.path);
    const captured = model.values.capture(callback, bindings);
    captured.paths.forEach((path) => context.paths.add(path));
    return captured.value;
  }
  function expand(model, node, target, bindings, returning, callback) {
    if (++calls > limits.flowCalls) return failure('javascript-flow-call-limit');
    if (catalog && !catalog.take()) return failure('flow-work-limit');
    if (context.depth >= limits.flowDepth) return failure('javascript-flow-depth-limit');
    if (context.active.has(target.node)) return failure('javascript-flow-cycle');
    const body = functionBody(target.node, returning);
    const unresolved = returning
      ? 'javascript-return-not-resolved'
      : 'javascript-wrapper-not-resolved';
    if (
      !body ||
      !target.owner ||
      (returning &&
        (target.owner.values.state.moduleMutated || target.owner.values.state.loaderMutated)) ||
      node.optional ||
      node.arguments.some((argument) => argument.type === 'SpreadElement') ||
      node.arguments.length !== target.node.params.length
    )
      return failure(unresolved);
    context.depth++;
    try {
      const arguments_ = capture(
        model,
        () => node.arguments.map((argument) => model.values.read(argument)),
        bindings,
      );
      if (arguments_.some((value) => !primitive(value)))
        return failure('javascript-flow-argument-not-resolved');
      context.active.add(target.node);
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
              primitive(value) ||
              (!returning &&
                value !== UNKNOWN &&
                !Array.isArray(value) &&
                !(value instanceof Map) &&
                value?.kind !== 'local-function')
            );
          }),
        nextBindings,
      );
      if (!valid) return failure(unresolved);
      context.expanded = true;
      issues.add('javascript-control-flow-not-evaluated');
      return callback(target.owner, body.value, nextBindings);
    } finally {
      context.active.delete(target.node);
      context.depth--;
    }
  }
  function returned(model, node) {
    if (!context || model.preparing) return UNKNOWN;
    const target = capture(model, () => model.values.read(node.callee));
    if (target?.kind !== 'local-function') return failure('javascript-return-not-resolved');
    const value = expand(model, node, target, undefined, true, (owner, expression, bindings) =>
      capture(owner, () => owner.values.read(expression), bindings),
    );
    return primitive(value) ? value : failure('javascript-return-not-resolved');
  }
  function visit(model, node, bindings) {
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
    return expand(model, node, target, bindings, false, visit);
  }
  function inspect(root, entry) {
    context = { paths: new Set([root.path]), active: new Set(), depth: 0, expanded: false };
    try {
      const inspected = visit(root, entry, new Map());
      const result = inspected === UNKNOWN ? { rules: [], commands: 0 } : inspected;
      if (context.expanded || context.paths.size > 1)
        result.flow = { sink: result.sink, paths: [...context.paths].sort() };
      return result;
    } finally {
      context = null;
    }
  }
  return { inspect, returned };
}

module.exports = { createJavaScriptFlow };
