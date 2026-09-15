'use strict';

const { TextDecoder } = require('node:util');

const FLOW_LIMITS = Object.freeze({
  flowFiles: 128,
  flowChars: 1048576,
  flowSourceChars: 65536,
  flowDepth: 8,
  flowModules: 32,
  flowCalls: 256,
  flowEvidence: 16,
  flowWork: 32768,
  flowResolutions: 2048,
});
const folded = (name) => name.normalize('NFKC').toLowerCase();
const failure = (issue) => ({ issue });

function relativeTarget(from, reference) {
  if (
    !/^\.\.?\//.test(reference) ||
    reference.length > 1024 ||
    /[\\:%?#]/.test(reference) ||
    [...reference].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return null;
  const parts = from.split('/').slice(0, -1);
  for (const part of reference.split('/')) {
    if (part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else {
      if (!part || /[. ]$/.test(part)) return null;
      parts.push(part);
    }
  }
  return parts.join('/');
}

/**
 * Index only bytes admitted by the existing selected-directory reader.
 * Imports cannot initiate filesystem access. Missing/excluded sources stay unknown.
 * @param {Array<{path:string,file:object,entry:object}>} snapshots Successful selected reads, sorted by path.
 * @param {Array<{path:string,reason:string}>} readIssues Observed but unreadable names.
 * @returns {object} Scan-local source resolver, budgets and fixed admission issues.
 * @since v0.15.1
 */
function createStaticCatalog(snapshots, readIssues = []) {
  const observed = new Map();
  const unavailable = new Set(
    readIssues.filter(({ path }) => path).map(({ path }) => folded(path)),
  );
  for (const name of [
    ...snapshots.map((item) => item.path),
    ...readIssues.map((item) => item.path),
  ]) {
    if (!name) continue;
    const key = folded(name);
    if (!observed.has(key)) observed.set(key, new Set());
    observed.get(key).add(name);
  }
  const sources = new Map();
  const issues = [];
  let chars = 0;
  let work = 0;
  let resolutions = 0;
  for (const { path, file, entry } of snapshots) {
    if (entry.kind === 'policy' || entry.format || !/\.(?:js|mjs|cjs|py)$/i.test(path)) continue;
    if (observed.get(folded(path)).size > 1) {
      issues.push({ path, reason: 'flow-path-ambiguous' });
      continue;
    }
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.data);
    } catch (_) {
      continue;
    }
    if (text.includes('\0') || text.length > FLOW_LIMITS.flowSourceChars) continue;
    if (sources.size >= FLOW_LIMITS.flowFiles) {
      issues.push({ path, reason: 'flow-source-file-limit' });
      continue;
    }
    if (chars + text.length > FLOW_LIMITS.flowChars) {
      issues.push({ path, reason: 'flow-source-char-limit' });
      continue;
    }
    chars += text.length;
    sources.set(path, Object.freeze({ path, text, sha256: file.sha256 }));
  }
  function resolve(from, specifier, language) {
    if (resolutions >= FLOW_LIMITS.flowResolutions) return failure('flow-resolution-limit');
    resolutions++;
    if (!sources.has(from)) return failure('flow-source-not-selected');
    if (typeof specifier !== 'string') return failure('flow-module-reference-unsupported');
    let target;
    if (language === 'javascript') {
      if (!/\.(?:js|mjs|cjs)$/.test(specifier)) return failure('flow-module-reference-unsupported');
      target = relativeTarget(from, specifier);
    } else if (language === 'python') {
      const match = /^(\.*)([A-Za-z_]\w*)$/.exec(specifier);
      if (!match || match[2] === '__init__' || /(?:^|\/)__init__\.py$/i.test(from))
        return failure('flow-module-reference-unsupported');
      const ascent = Math.max(0, match[1].length - 1);
      target = relativeTarget(from, `${ascent ? '../'.repeat(ascent) : './'}${match[2]}.py`);
      if (
        target &&
        (observed.has(folded(target.replace(/\.py$/, '/__init__.py'))) ||
          unavailable.has(folded(target.replace(/\.py$/, ''))))
      )
        return failure('flow-module-ambiguous');
    } else return failure('flow-module-reference-unsupported');
    if (!target) return failure('flow-module-reference-unsupported');
    const candidates = observed.get(folded(target));
    if (candidates && (candidates.size !== 1 || !candidates.has(target)))
      return failure('flow-module-ambiguous');
    return sources.get(target) ?? failure('flow-module-not-selected');
  }
  return Object.freeze({
    limits: FLOW_LIMITS,
    issues: Object.freeze(issues),
    get: (name) => sources.get(name) ?? null,
    resolve,
    take: () => {
      if (work >= FLOW_LIMITS.flowWork) return false;
      work++;
      return true;
    },
    usage: () => ({
      flowFiles: sources.size,
      flowChars: chars,
      flowWork: work,
      flowResolutions: resolutions,
    }),
  });
}

/**
 * Bind internal source references to observed hashes without exporting code or values.
 * @param {object} flow Internal sink and contributing path list.
 * @param {string} caller Finding's selected source path.
 * @param {object} catalog Current scan's in-memory catalog.
 * @returns {{value?:object,issue?:string}} Hash-bound evidence or a fixed incompleteness reason.
 * @since v0.15.1
 */
function bindStaticFlow(flow, caller, catalog) {
  if (
    !flow ||
    !Array.isArray(flow.paths) ||
    !flow.sink ||
    typeof caller !== 'string' ||
    typeof flow.sink.path !== 'string' ||
    !flow.paths.every((name) => typeof name === 'string')
  )
    return failure('flow-evidence-invalid');
  if (flow.paths.length > FLOW_LIMITS.flowEvidence) return failure('flow-evidence-limit');
  const names = [...new Set([caller, flow.sink.path, ...flow.paths])].sort();
  if (names.length > FLOW_LIMITS.flowEvidence) return failure('flow-evidence-limit');
  const files = [];
  for (const name of names) {
    if (typeof name !== 'string') return failure('flow-evidence-invalid');
    const source = catalog.get(name);
    if (!source) return failure('flow-evidence-unavailable');
    files.push({ path: name, sha256: source.sha256 });
  }
  const sink = catalog.get(flow.sink.path);
  if (
    !Number.isSafeInteger(flow.sink.line) ||
    flow.sink.line < 1 ||
    flow.sink.line > sink.text.split(/\r\n|\n|\r/).length
  )
    return failure('flow-evidence-invalid');
  return { value: { sink: { path: sink.path, sha256: sink.sha256, line: flow.sink.line }, files } };
}

module.exports = { createStaticCatalog, bindStaticFlow, FLOW_LIMITS };
