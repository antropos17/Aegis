'use strict';

const { commaGroups } = require('./static-python-tree');
const { UNKNOWN } = require('./static-python-values');
const { inspectPythonInvocation } = require('./static-python-invocation');
const { COMMANDS_PER_FILE } = require('./static-config-analysis');

const DEFAULT_LIMITS = { flowDepth: 8, flowModules: 32, flowCalls: 256, flowEvidence: 16 };

/** Recognize a straight-line Python process wrapper without executing it. @param {object} model @param {object} binding @returns {object|null} Parameter bindings and one call, or unsupported. @since v0.15.1 */
function pythonWrapperShape(model, binding) {
  const { definition, inner } = binding;
  if (
    !definition ||
    binding.mutated ||
    inner.dynamic ||
    model.index.parents.get(definition) !== model.parsed.root ||
    definition.children.length !== 4 ||
    definition.children[0]?.type !== 'def'
  )
    return null;
  const params = definition.children.find((node) => node.type === 'ParamList');
  const groups = commaGroups(params?.children.slice(1, -1) ?? []);
  if (
    groups.length > 8 ||
    groups.some((group) => group.length !== 1 || group[0].type !== 'VariableName')
  )
    return null;
  const parameters = groups.map(([node]) => inner.bindings.get(model.parsed.identifier(node)));
  if (parameters.some((parameter) => parameter?.kind !== 'parameter' || parameter.mutated))
    return null;
  const body = definition.children.find((node) => node.type === 'Body');
  const statements = (body?.children ?? []).filter((node) => ![':', 'Comment'].includes(node.type));
  if (statements[0]?.type === 'ExpressionStatement' && statements[0].children[0]?.type === 'String')
    statements.shift();
  if (statements.length !== 1) return null;
  const statement = statements[0];
  const call =
    statement.type === 'ExpressionStatement'
      ? statement.children[0]
      : statement.type === 'ReturnStatement'
        ? statement.children[1]
        : null;
  return call?.type === 'CallExpression' ? { parameters, call } : null;
}

/** Follow bounded selected-file constants and simple Python call wrappers. @param {string} name @param {object|undefined} catalog Read-only selected-source catalog. @param {Set<string>} issues @param {function} prepare Bounded model factory. @returns {object} Model hooks, call inspection and fixed results. @since v0.15.1 */
function createPythonFlow(name, catalog, issues, prepare) {
  const limits = { ...DEFAULT_LIMITS, ...catalog?.limits };
  const models = new Map();
  const resolving = new Set();
  const frames = [];
  const findings = [];
  let paths = null,
    entry = null,
    overflow = false,
    expansions = 0,
    commands = 0;
  function fail(reason) {
    issues.add(reason);
    return UNKNOWN;
  }
  function work() {
    if (!catalog || catalog.take()) return true;
    fail('flow-work-limit');
    return false;
  }
  function remember(file) {
    if (!paths || paths.has(file)) return true;
    if (paths.size >= limits.flowEvidence) {
      overflow = true;
      fail('flow-evidence-limit');
      return false;
    }
    paths.add(file);
    return true;
  }
  function modelFor(record) {
    if (models.has(record.path)) return models.get(record.path);
    if (models.size >= limits.flowModules) {
      fail('flow-module-limit');
      return null;
    }
    const model = prepare(record.text, record.path, hooks);
    models.set(record.path, model);
    return model;
  }
  function exported(record, symbol) {
    if (!work() || !remember(record.path)) return UNKNOWN;
    const key = JSON.stringify([record.path, symbol]);
    if (resolving.has(key)) return fail('python-import-cycle-not-resolved');
    if (resolving.size >= limits.flowDepth) return fail('flow-depth-limit');
    resolving.add(key);
    try {
      const model = modelFor(record);
      if (
        !model ||
        model.parsed.issue ||
        model.values.state.modulesInvalid ||
        model.values.state.flowInvalid ||
        model.index.moduleScope.dynamic
      )
        return fail('python-export-not-resolved');
      const binding = model.index.moduleScope.bindings.get(symbol);
      const declaration = binding && model.index.parents.get(binding.node);
      if (!binding || binding.mutated || model.index.parents.get(declaration) !== model.parsed.root)
        return fail('python-export-not-resolved');
      if (binding.kind === 'function') return { kind: 'function', binding, model };
      if (binding.kind !== 'assignment') return fail('python-export-not-resolved');
      const value = model.values.read(binding.init);
      return typeof value === 'string' ? value : fail('python-export-not-resolved');
    } finally {
      resolving.delete(key);
    }
  }
  function hooks(model) {
    return {
      import(binding) {
        if (model.validating) return { kind: binding.method ? 'import-symbol' : 'local-module' };
        if (model.values.state.flowInvalid) return UNKNOWN;
        if (!catalog || !work()) return UNKNOWN;
        const record = catalog.resolve(model.path, binding.module, 'python');
        if (record.issue) return fail(record.issue);
        issues.add('python-import-runtime-not-verified');
        if (!remember(record.path)) return UNKNOWN;
        return binding.method ? exported(record, binding.method) : { kind: 'local-module', record };
      },
      member(target, symbol) {
        if (model.values.state.modulesInvalid || target?.kind !== 'local-module') return UNKNOWN;
        if (model.validating) return { kind: 'import-symbol' };
        return exported(target.record, symbol);
      },
      function: (binding) =>
        model.values.state.flowInvalid ? UNKNOWN : { kind: 'function', binding, model },
      visible(binding) {
        if (
          frames.length &&
          entry?.path === model.path &&
          binding.scope === model.index.moduleScope &&
          binding.from > entry.from
        ) {
          fail('python-binding-not-resolved');
          return false;
        }
        return true;
      },
      parameter(binding) {
        const frame = frames.findLast((candidate) => candidate.has(binding));
        return frame ? frame.get(binding) : UNKNOWN;
      },
    };
  }
  function invoke(model, node, origin, stack) {
    if (model.escapesArguments(node)) {
      model.values.state.modulesInvalid = true;
      fail('python-module-escape-not-resolved');
      return;
    }
    const target = model.values.read(node.children[0]);
    if (target?.kind === 'method') {
      if (commands >= COMMANDS_PER_FILE) {
        fail('command-count-limit');
        return;
      }
      commands++;
      const result = inspectPythonInvocation(
        target.name,
        node,
        model.values.read,
        model.parsed.source,
      );
      result.issues.forEach((reason) => issues.add(reason));
      if (overflow) return;
      const flowed = stack.length > 0 || paths.size > 1;
      result.rules.forEach((ruleId) =>
        findings.push({
          ruleId,
          line: flowed ? origin.line : model.parsed.lineAt(node.from),
          context: flowed ? 'python-command-flow' : 'python-command',
          ...(flowed
            ? {
                flow: {
                  sink: { path: model.path, line: model.parsed.lineAt(node.from) },
                  paths: [...paths].sort(),
                },
              }
            : {}),
        }),
      );
      return;
    }
    if (target?.kind !== 'function') {
      fail('python-call-target-not-resolved');
      return;
    }
    if (!work()) return;
    if (expansions++ >= limits.flowCalls) {
      fail('flow-call-limit');
      return;
    }
    if (stack.length >= limits.flowDepth) {
      fail('flow-depth-limit');
      return;
    }
    if (stack.includes(target.binding)) {
      fail('python-call-cycle-not-resolved');
      return;
    }
    const shape = pythonWrapperShape(target.model, target.binding);
    if (!shape) {
      fail('python-function-not-resolved');
      return;
    }
    const argList = node.children[1];
    const arguments_ = commaGroups(argList?.children.slice(1, -1) ?? []);
    if (
      argList?.type !== 'ArgList' ||
      arguments_.length !== shape.parameters.length ||
      arguments_.some((group) => group.length !== 1)
    ) {
      fail('python-function-arguments-not-resolved');
      return;
    }
    const values = arguments_.map(([argument]) => model.values.read(argument));
    if (
      values.some(
        (value) =>
          !['string', 'boolean'].includes(typeof value) &&
          value !== null &&
          !(Array.isArray(value) && value.every((item) => typeof item === 'string')),
      )
    ) {
      fail('python-function-arguments-not-resolved');
      return;
    }
    if (!remember(target.model.path)) return;
    issues.add('python-control-flow-not-evaluated');
    frames.push(new Map(shape.parameters.map((parameter, index) => [parameter, values[index]])));
    try {
      invoke(target.model, shape.call, origin, [...stack, target.binding]);
    } finally {
      frames.pop();
    }
  }
  return {
    root: (text) => modelFor({ path: name, text }),
    inspect(model, node) {
      paths = new Set([model.path]);
      entry = { path: model.path, from: node.from };
      overflow = false;
      invoke(model, node, { line: model.parsed.lineAt(node.from) }, []);
      paths = null;
      entry = null;
    },
    result: () => ({ findings, issues: [...issues].sort(), commands }),
  };
}

module.exports = { createPythonFlow, pythonWrapperShape };
