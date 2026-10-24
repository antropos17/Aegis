'use strict';
const fs = require('node:fs');
const path = require('node:path');
const c = require('./resource-replay-common');
const json = require('./resource-replay-json');
const io = require('./resource-replay-io');
const current = require('./resource-replay-current');
const { validateParent } = require('./resource-replay-parent');
const { validateChild } = require('./resource-replay-child');
/** @param {object} value Closed paths. @returns {object} Nonoverlapping resolved paths. @since unreleased */
function options(value) {
  try {
    if (
      !value ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== 2
    )
      c.fail();
    const out = {};
    for (const key of ['input', 'out']) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (
        !d?.enumerable ||
        !Object.hasOwn(d, 'value') ||
        typeof d.value !== 'string' ||
        !d.value ||
        d.value.length > 4096 ||
        d.value.includes('\0') ||
        /^[/\\]{2}/.test(d.value)
      )
        c.fail();
      out[key] = path.resolve(d.value);
      if (out[key] === path.parse(out[key]).root) c.fail();
    }
    const a = process.platform === 'win32' ? out.input.toLowerCase() : out.input;
    const b = process.platform === 'win32' ? out.out.toLowerCase() : out.out;
    if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) c.fail();
    return out;
  } catch {
    throw Error('resource-replay-input-invalid');
  }
}
function load(input, report) {
  io.directory(input);
  let capture = true;
  try {
    fs.lstatSync(path.join(input, 'capture'));
    io.directory(path.join(input, 'capture'));
  } catch (error) {
    if (error.code === 'ENOENT') capture = false;
    else c.fail();
  }
  const bundle = {},
    budget = { bytes: 0 };
  for (const [file, cap] of Object.entries(io.CAPS)) {
    const bytes =
      file.startsWith('capture/') && !capture
        ? null
        : io.read(path.join(input, file), cap, budget, true);
    if (bytes === null) {
      bundle[file] = null;
      report.input.missing.push(file);
      continue;
    }
    const part = { file, sha256: json.hash(bytes), byteLength: bytes.length, closed: true };
    bundle[file] = part;
    report.input.files.push({
      file,
      sha256: part.sha256,
      byteLength: part.byteLength,
      closed: true,
    });
    report.input.bytes = budget.bytes;
    part.value = json.parse(bytes);
  }
  report.input.bytes = budget.bytes;
  return bundle;
}
function replay(bundle, child, evaluate) {
  const result = {
    state: 'not-attempted',
    basis: 'none',
    storedDerivedCompared: false,
    entireStoredResultEqual: null,
  };
  const packet = child.derived
    ? { raw: child.derived.raw, plan: child.derived.plan, provenance: child.derived.provenance }
    : child.raw && child.plan
      ? {
          raw: child.raw,
          plan: child.plan.plan,
          provenance: { sourceSha256: bundle['capture/session-plan.json'].sha256 },
        }
      : null;
  if (!packet) return result;
  if (!evaluate) return { ...result, state: 'unavailable' };
  let recomputed;
  try {
    recomputed = evaluate(packet);
  } catch (error) {
    if (error.message === 'bracketed-resource-input-invalid') c.fail();
    return { ...result, state: 'unavailable' };
  }
  if (child.derived && !c.equal(recomputed, child.derived)) c.fail();
  return {
    state: 'recomputed',
    basis: child.derived ? 'stored-derived-embedded' : 'external-raw-and-plan',
    storedDerivedCompared: !!child.derived,
    entireStoredResultEqual: child.derived ? true : null,
  };
}
/** Inspect exactly eight supervised artifacts offline and publish one fresh deterministic report.
 * @param {object} input Closed input and out directory strings.
 * @returns {object} Fixed exitCode and safe report, null for invalid options.
 * @since unreleased
 */
function inspectResourceReplay(input) {
  let o;
  try {
    o = options(input);
  } catch {
    return { exitCode: 2, report: null };
  }
  const report = {
    version: 'resource-session-replay/1',
    scope: 'offline-supervised-resource-bundle',
    classification: 'incomplete',
    reason: 'missing-or-incomplete-evidence',
    runId: null,
    finalPublication: 'not-self-attested',
    parentFinalPublication: 'unknown',
    childFinalPublication: 'unknown',
    reportedChildPublicationSupport: 'unknown',
    streamDigestAssessment: 'recorded-prefix-claims-empty-digest-checked',
    input: { files: [], missing: [], bytes: 0 },
    historical: {
      parentState: null,
      childState: null,
      executionMode: null,
      readingMode: null,
      sourceAlignment: 'unknown',
      evaluator: null,
    },
    acquisition: null,
    exclusions: null,
    replay: {
      state: 'not-attempted',
      basis: 'none',
      storedDerivedCompared: false,
      entireStoredResultEqual: null,
    },
    current: {
      sources: { state: 'unavailable', before: null, after: null },
      evaluator: {
        file: 'bench/lib/bracketed-resource-intervals.js',
        sha256: null,
        byteLength: null,
        nodeVersion: process.version,
        historicalComparison: 'unknown',
        loadedCodeAuthenticated: false,
      },
    },
    sourceAuthenticated: false,
    measurementAccepted: false,
    w8Accepted: false,
  };
  let before = null,
    available = true,
    parent,
    child,
    bundle,
    refused = false;
  try {
    before = current.inventory();
    report.current.sources.before = before;
  } catch {
    available = false;
  }
  const evaluate = available ? current.evaluator() : null;
  if (!evaluate) available = false;
  try {
    bundle = load(o.input, report);
    parent = validateParent(bundle);
    child = validateChild(bundle, parent);
    c.links(bundle);
    report.runId = c.bind(bundle);
    report.historical = {
      parentState: parent.final?.state ?? null,
      childState: child.final?.state ?? null,
      executionMode: parent.final?.executionMode ?? parent.plan?.executionMode ?? null,
      readingMode:
        child.raw?.readingMode ??
        child.derived?.raw.readingMode ??
        child.final?.acquisition.readingMode ??
        null,
      sourceAlignment: child.sourceAlignment,
      evaluator: null,
    };
    report.reportedChildPublicationSupport =
      parent.success === true
        ? 'supported-by-reported-lifecycle'
        : parent.success === false
          ? 'not-supported'
          : 'unknown';
    report.replay = replay(bundle, child, evaluate);
    if (report.replay.state === 'unavailable') available = false;
    const rawEvidence = child.raw ?? child.derived?.raw;
    if (rawEvidence)
      report.acquisition = {
        basis: child.raw ? 'raw-artifact' : 'stored-derived-raw',
        complete: rawEvidence.complete,
        plannedPoints: rawEvidence.plannedPoints,
        observedPoints: rawEvidence.samples.length,
        missedPoints: rawEvidence.missed.length,
        unattemptedPoints: rawEvidence.unattempted?.count ?? 0,
        stopReason: rawEvidence.stopReason,
        populationComplete: null,
        osBirthTime: null,
        readingFailures: rawEvidence.samples.map((s, i) => ({
          sample: i,
          cpuReason: s.cpu.reason,
          rssReason: s.rss.reason,
        })),
      };
    if (child.derived)
      report.exclusions = {
        cpu: child.derived.intervals.map((r) => ({
          fromSample: r.fromSample,
          toSample: r.toSample,
          reason: r.reason,
        })),
        memory: child.derived.memory.map((r) => ({ sample: r.sample, reason: r.reason })),
        closingScheduledPoint: false,
      };
  } catch {
    refused = true;
  }
  try {
    const after = current.inventory();
    report.current.sources.after = after;
    report.current.sources.state =
      before && c.equal(before, after) ? 'unchanged' : before ? 'changed' : 'unavailable';
    if (report.current.sources.state !== 'unchanged') available = false;
  } catch {
    available = false;
  }
  const evaluatorIdentity = before?.files.find(
    (f) => f.file === 'bench/lib/bracketed-resource-intervals.js',
  );
  const declaredInventory = child?.plan?.sources ?? parent?.plan?.sources;
  const historical = declaredInventory?.files.at(-1);
  if (historical)
    report.historical.evaluator = {
      ...historical,
      nodeVersion: declaredInventory.nodeVersion,
      basis: child?.plan ? 'child-plan-declaration' : 'parent-plan-declaration',
      sourceAuthenticated: false,
    };
  if (evaluatorIdentity) {
    report.current.evaluator.sha256 = evaluatorIdentity.sha256;
    report.current.evaluator.byteLength = evaluatorIdentity.byteLength;
    report.current.evaluator.historicalComparison = historical
      ? historical.sha256 === evaluatorIdentity.sha256 &&
        historical.byteLength === evaluatorIdentity.byteLength
        ? 'match'
        : 'different'
      : 'unknown';
  }
  const complete =
    !refused &&
    report.input.missing.length === 0 &&
    parent?.success === true &&
    parent.final.sources.state === 'unchanged' &&
    child?.final?.state === 'complete-candidate' &&
    child.raw?.complete === true &&
    child.sourceAlignment === 'match' &&
    report.replay.entireStoredResultEqual === true;
  report.classification = refused
    ? 'refused'
    : !available
      ? 'replay-unavailable'
      : complete
        ? 'consistent-for-conditional-replay'
        : 'incomplete';
  report.reason = refused
    ? 'bundle-refused'
    : !available
      ? 'current-evaluator-or-source-unavailable'
      : complete
        ? 'structural-and-current-arithmetic-agreement'
        : 'missing-or-incomplete-evidence';
  let exitCode = refused ? 4 : !available ? 7 : complete ? 0 : 3;
  try {
    io.publish(o.out, report);
  } catch (error) {
    exitCode = error.message === 'resource-replay-output-refused' ? 5 : 6;
  }
  return { exitCode, report };
}
module.exports = { inspectResourceReplay, options };
