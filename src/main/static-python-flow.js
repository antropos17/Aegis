'use strict';

const { UNKNOWN } = require('./static-python-values');
const { createPythonFunctions, isPythonPrimitive } = require('./static-python-functions');
const { inspectPythonInvocation } = require('./static-python-invocation');
const { COMMANDS_PER_FILE } = require('./static-config-analysis');

const DEFAULT_LIMITS = { flowDepth: 8, flowModules: 32, flowCalls: 256, flowEvidence: 16 };

/** Follow bounded selected-file constants, primitive returns and Python call wrappers. @param {string} name @param {object|undefined} catalog Read-only selected-source catalog. @param {Set<string>} issues @param {function} prepare Bounded model factory. @returns {object} Model hooks, call inspection and fixed results. @since v0.15.1 */
function createPythonFlow(name, catalog, issues, prepare) {
  const limits = { ...DEFAULT_LIMITS, ...catalog?.limits };
  const models = new Map();
  const resolving = new Set();
  const findings = [];
  let paths = null,
    entry = null,
    overflow = false,
    expanded = false,
    commands = 0;
  const functions = createPythonFunctions(limits, {
    fail,
    work,
    remember,
    expanded() {
      expanded = true;
      issues.add('python-control-flow-not-evaluated');
    },
  });
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
    model.finalizing = true;
    try {
      model.validateReturnEscapes?.();
    } finally {
      model.finalizing = false;
    }
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
        model.finalizing ||
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
      const value = model.values.read(binding.node);
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
          functions.hasFrames() &&
          entry?.path === model.path &&
          binding.scope === model.index.moduleScope &&
          binding.from > entry.from
        ) {
          fail('python-binding-not-resolved');
          return false;
        }
        return true;
      },
      parameter: functions.parameter,
      call: (node) => returned(model, node),
      assignment(binding, read) {
        const previous = entry;
        if (binding.scope === model.index.moduleScope)
          entry = { path: model.path, from: binding.init.from };
        try {
          return read();
        } finally {
          entry = previous;
        }
      },
    };
  }
  function escaped(model, node) {
    if (model.escapesCall(node)) {
      model.values.state.modulesInvalid = true;
      fail('python-module-escape-not-resolved');
      return true;
    }
    return false;
  }
  function returned(model, node) {
    if (
      !paths ||
      model.validating ||
      model.values.state.returnsDisabled ||
      model.values.state.modulesInvalid ||
      model.values.state.flowInvalid
    )
      return UNKNOWN;
    if (escaped(model, node)) return UNKNOWN;
    const target = model.values.read(node.children[0]);
    if (target?.kind !== 'function') return fail('python-return-not-resolved');
    const value = functions.expand(model, node, target, true, (shape) =>
      target.model.values.read(shape.expression),
    );
    return isPythonPrimitive(value) ? value : fail('python-return-not-resolved');
  }
  function invoke(model, node, origin) {
    if (escaped(model, node)) return;
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
      const flowed = expanded || paths.size > 1;
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
    functions.expand(model, node, target, false, (shape) => {
      if (shape.expression.type === 'CallExpression')
        invoke(target.model, shape.expression, origin);
      else fail('python-call-target-not-resolved');
    });
  }
  return {
    root: (text) => modelFor({ path: name, text }),
    inspect(model, node) {
      paths = new Set([model.path]);
      entry = { path: model.path, from: node.from };
      overflow = false;
      expanded = false;
      invoke(model, node, { line: model.parsed.lineAt(node.from) });
      paths = null;
      entry = null;
    },
    result: () => ({ findings, issues: [...issues].sort(), commands }),
  };
}

module.exports = { createPythonFlow };
