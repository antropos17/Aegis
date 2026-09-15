'use strict';

/** @file Static component inventory. No execution, network, persistence or risk verdict. */
const { createInventoryReader } = require('./inventory-reader');
const { summarizeConfig, PARSE_DEPTH } = require('./inventory-config');
const { getInventoryProfile, matchesInventoryConfig } = require('./inventory-profiles');
const { createPackageInventory, PACKAGE_FILES, PACKAGE_LIMIT } = require('./inventory-packages');

async function inventoryLayout(directory, profile, options) {
  const reader = await createInventoryReader(directory, options.limits);
  const packageInventory = createPackageInventory(reader);
  const components = [];
  function record(relativePath, file, entry, metadata = {}) {
    packageInventory.observe(
      relativePath,
      file,
      profile.id === 'project' ? '' : (entry.packageBoundary ?? null),
    );
    components.push({
      path: relativePath,
      kind: entry.kind,
      size: file.size,
      sha256: file.sha256,
      provenance: {
        agent: entry.agent,
        scope: entry.scope,
        basis: 'selected-layout',
        agentVersion: null,
        packageIdentity: 'not-resolved',
      },
      ...metadata,
    });
  }
  function recordConfig(name, file, entry) {
    const metadata = summarizeConfig(file.data, entry.format, entry.sections, entry.localProjects);
    record(name, file, entry, { format: entry.format, ...metadata });
    if (metadata.parseStatus !== 'parsed') {
      reader.issues.push({ path: name, reason: metadata.parseStatus });
    }
  }
  for (const entry of profile.configs) {
    await reader.visit(entry.path, (name, file) => recordConfig(name, file, entry));
  }
  for (const entry of profile.configPatterns) {
    await reader.visitMatching(
      entry.directory,
      (name) => matchesInventoryConfig(entry.match, name),
      (name, file) => recordConfig(name, file, entry.template),
    );
  }
  for (const entry of profile.instructions) {
    await reader.visit(entry.path, (name, file) =>
      record(name, file, { ...entry, kind: 'instruction' }),
    );
  }
  if (profile.id === 'project') {
    for (const name of PACKAGE_FILES) {
      await reader.visit(name, (relativePath, file) =>
        record(relativePath, file, {
          kind: name === 'package.json' ? 'package-manifest' : 'package-lock',
          agent: 'unspecified',
          scope: 'project',
        }),
      );
    }
  }
  for (const entry of profile.skillRoots) {
    await reader.visit(
      entry.path,
      (name, file) =>
        record(name, file, {
          ...entry,
          packageBoundary: entry.path,
          kind: name.split('/').at(-1) === 'SKILL.md' ? 'skill-manifest' : 'skill-file',
        }),
      true,
      0,
      ['.git'],
    );
  }
  const packageEvidence = await packageInventory.finish(components);
  return {
    schemaVersion: 3,
    mode: profile.id === 'project' ? 'project-inventory' : 'profile-inventory',
    adapter: {
      id: profile.id,
      version: profile.adapterVersion,
      referenceDate: profile.referenceDate,
    },
    assessment: 'not-performed',
    complete: reader.issues.length === 0,
    scope: {
      configs: profile.configs.map((entry) => entry.path),
      configPatterns: profile.configPatterns.map(({ directory: dir, match }) => ({
        directory: dir,
        match,
      })),
      instructions: profile.instructions.map((entry) => entry.path),
      skillRoots: profile.skillRoots.map((entry) => entry.path),
      skillExclusions: ['.git (case-insensitive)'],
      packageFiles: profile.id === 'project' ? [...PACKAGE_FILES] : [],
      packageEvidence:
        profile.id === 'project'
          ? 'selected-project-root-and-scanned-skills'
          : 'scanned-skills-only',
      gitEvidence: 'loose-objects-manifest-only',
      links: 'skipped-below-selected-root',
      snapshot: 'best-effort',
      selection: 'explicit-directory',
      configurationPrecedence: 'not-resolved',
    },
    limits: {
      ...reader.limits,
      parseDepth: PARSE_DEPTH,
      packages: PACKAGE_LIMIT,
      gitInflatedBytes: reader.limits.totalBytes,
    },
    usage: { ...reader.usage(), gitInflatedBytes: packageEvidence.gitUsage.inflatedBytes },
    packages: packageEvidence.packages,
    components: components.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    issues: reader.issues,
  };
}

/**
 * Inventory recognized locations within one explicit project directory.
 * `complete` describes this scope; it does not attest machine discovery or safety.
 * @param {string} directory Project to inspect (no implicit home/profile scan).
 * @param {{limits?: object}} [options] Optional lower filesystem budgets.
 * @returns {Promise<object>} Versioned JSON-safe snapshot with fingerprints and counts.
 * @since v0.15.1
 */
async function inventoryProject(directory, options = {}) {
  return inventoryLayout(directory, getInventoryProfile('project'), options);
}

/**
 * Inventory a built-in user/system layout under an explicitly selected root.
 * Does not infer active profiles, installed versions or effective policy.
 * @param {string} id Profile adapter ID.
 * @param {string} directory Selected root, possibly a copied profile for offline inspection.
 * @param {{limits?: object}} [options] Optional lower filesystem budgets.
 * @returns {Promise<object>} Versioned JSON-safe profile snapshot.
 * @since v0.15.1
 */
async function inventoryProfile(id, directory, options = {}) {
  const profile = getInventoryProfile(id);
  if (id === 'project') throw new Error('unsupported-profile');
  return inventoryLayout(directory, profile, options);
}

module.exports = { inventoryProject, inventoryProfile };
