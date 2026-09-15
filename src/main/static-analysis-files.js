'use strict';

const { createInventoryReader } = require('./inventory-reader');
const { getInventoryProfile, matchesInventoryConfig } = require('./inventory-profiles');

/**
 * Visit explicit layouts or an entire selected package with the shared read bounds.
 * The callback receives bounded bytes; no file contents are returned in scope metadata.
 * @param {string} adapter Built-in inventory adapter or package.
 * @param {string} root Canonical selected directory.
 * @param {function} onFile Internal byte consumer.
 * @param {object} [limits] Optional lower filesystem budgets.
 * @returns {Promise<object>} Declared scope, usage and fixed reader issues.
 * @since v0.15.1
 */
async function visitStaticFiles(adapter, root, onFile, limits) {
  const profile = adapter === 'package' ? null : getInventoryProfile(adapter);
  const reader = await createInventoryReader(root, limits);
  const seen = new Set();
  const record = (name, file, entry = {}) => {
    if (seen.has(name)) return;
    seen.add(name);
    onFile(name, file, entry);
  };
  if (!profile) await reader.visit('', (name, file) => record(name, file), true, 0, ['.git']);
  else {
    for (const entry of profile.configs)
      await reader.visit(entry.path, (name, file) => record(name, file, entry));
    for (const entry of profile.configPatterns)
      await reader.visitMatching(
        entry.directory,
        (name) => matchesInventoryConfig(entry.match, name),
        (name, file) => record(name, file, entry.template),
      );
    for (const entry of profile.instructions)
      await reader.visit(entry.path, (name, file) => record(name, file, { kind: 'instruction' }));
    if (adapter === 'project')
      await reader.visit('package.json', (name, file) => record(name, file));
    for (const entry of profile.skillRoots)
      await reader.visit(entry.path, (name, file) => record(name, file), true, 0, ['.git']);
  }
  return {
    adapter: { id: adapter, version: profile?.adapterVersion ?? 1 },
    scope: {
      selection: 'explicit-directory',
      files: profile ? 'declared-agent-locations-and-skills' : 'selected-package-tree',
      configs: profile?.configs.map((entry) => entry.path) ?? [],
      configPatterns:
        profile?.configPatterns.map(({ directory, match }) => ({ directory, match })) ?? [],
      instructions: profile?.instructions.map((entry) => entry.path) ?? [],
      skillRoots: profile?.skillRoots.map((entry) => entry.path) ?? [],
      packageManifests: !profile
        ? 'within-selected-package'
        : adapter === 'project'
          ? 'project-root-and-skills'
          : 'scanned-skills',
      exclusions: ['.git (case-insensitive)'],
      links: 'skipped-below-selected-root',
      referencedCode: 'not-followed',
      dependencies: 'manifest-declarations-only',
      configurationPrecedence: 'not-resolved',
      instructionSemantics: 'not-analyzed',
      instructionPatterns: 'bounded-english-directives',
      shellRedirections: 'bounded-posix-stdio-associations',
      javascript: 'literal-node-child-process-calls',
      javascriptControlFlow: 'not-evaluated',
      python: 'literal-subprocess-and-os-calls',
      pythonControlFlow: 'not-evaluated',
      pythonModules: 'names-only-not-resolved',
      codeFlow: 'bounded-selected-source-literals-and-simple-wrappers',
      codeFlowReturns: 'bounded-primitive-function-returns',
      codeFlowResolution: 'syntactic-associations-runtime-not-verified',
      codeFlowSnapshot: 'per-file-bytes-no-atomic-project-snapshot',
      runtimeBehavior: 'not-observed',
      snapshot: 'best-effort',
    },
    limits: reader.limits,
    usage: reader.usage(),
    issues: reader.issues,
  };
}

module.exports = { visitStaticFiles };
