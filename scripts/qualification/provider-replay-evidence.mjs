import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runProviderPath, providerLoadedSourceCurrent } from './provider-replay-runner.mjs';
const proofs = new WeakMap();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const versions = Object.freeze({ claude: 'claude-hook-subset-v1', codex: 'codex-hook-subset-v1' });
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fields = [
  'provider',
  'adapterVersion',
  'clientVersion',
  'clientSha256',
  'helperSha256',
  'adapterSha256',
  'policySha256',
  'corpusSha256',
];
const bindingKey = (value) => JSON.stringify(fields.map((key) => value[key]));
const exact = (value, keys) =>
  value &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every(
    (key) =>
      Object.hasOwn(value, key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'),
  );
const validBinding = (value) =>
  exact(value, fields) &&
  Object.hasOwn(versions, value.provider) &&
  value.adapterVersion === versions[value.provider] &&
  value.clientVersion === 'generated-fixture-v1' &&
  fields.filter((key) => key.endsWith('Sha256')).every((key) => hex(value[key]));
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
const stage = (result, scope, source, freshness) => ({ result, scope, source, freshness });
const notRun = (scope) => stage('not-run', scope, 'none', 'unknown');
const validStage = (value) =>
  exact(value, ['result', 'scope', 'source', 'freshness']) &&
  ['fixture-configured', 'pass', 'fail', 'not-run'].includes(value.result) &&
  ['fresh', 'stale', 'unknown'].includes(value.freshness) &&
  ['scope', 'source'].every((key) => typeof value[key] === 'string' && value[key].length <= 128);

async function sourceBindings(provider) {
  const names = [
    '../../src/main/action-policy.js',
    '../../src/main/action-policy-session.js',
    '../../src/main/provider-adapter-common.js',
    `../../src/main/provider-${provider}-adapter.js`,
    './provider-replay-corpus.mjs',
    './provider-replay-runner.mjs',
    './provider-replay-metrics.mjs',
    './provider-replay-evidence.mjs',
  ];
  const sources = [];
  for (const name of names) {
    const bytes = await fs.readFile(new URL(name, import.meta.url));
    if (bytes.length > 65536) throw Error('provider-source-budget');
    sources.push({
      module: name.replace('../../', ''),
      rawSha256: sha(bytes),
      lfSha256: sha(Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))),
    });
  }
  const join = (indices) =>
    sha(Buffer.from(JSON.stringify(indices.map((index) => sources[index]))));
  return {
    sources,
    clientSha256: sources[5].rawSha256,
    helperSha256: join([0, 1]),
    adapterSha256: join([2, 3]),
    corpusSha256: join([4, 5, 6, 7]),
  };
}

/** Execute real fixed-fixture replay and issue a private, nonserializable observation proof.
 * No external report, success flag or caller effect callback is admitted.
 * @param {string} provider Fixed Claude or Codex profile.
 * @returns {Promise<{report:object,proof:object}>} Frozen report and process-private proof. @since v0.17.0 */
export async function qualifyProviderReplay(provider) {
  if (!Object.hasOwn(versions, provider)) throw Error('provider-profile-invalid');
  const source = await sourceBindings(provider);
  const loadedFresh = providerLoadedSourceCurrent();
  const baseline = await runProviderPath(provider, false);
  const adapter = await runProviderPath(provider, true);
  try {
    const after = await sourceBindings(provider);
    const fresh =
      loadedFresh &&
      providerLoadedSourceCurrent() &&
      JSON.stringify(source) === JSON.stringify(after) &&
      baseline.policyFresh &&
      adapter.policyFresh;
    const binding = {
      provider,
      adapterVersion: versions[provider],
      clientVersion: 'generated-fixture-v1',
      clientSha256: source.clientSha256,
      helperSha256: source.helperSha256,
      adapterSha256: source.adapterSha256,
      policySha256: sha(Buffer.concat(adapter.privatePolicies)),
      corpusSha256: source.corpusSha256,
    };
    const passed =
      fresh &&
      [baseline, adapter].every(
        (path) =>
          path.metrics.scenarioPasses === path.metrics.scenarioDenominator && path.recovery.passed,
      );
    const publicPath = (path) => ({
      configuration: path.configuration,
      metrics: path.metrics,
      recovery: path.recovery,
    });
    const report = freeze({
      schemaVersion: 1,
      provider,
      adapterVersion: versions[provider],
      observedAt: Date.now(),
      binding,
      sourceHashes: source.sources,
      configured: stage(
        'fixture-configured',
        'generated-local-policy',
        'qualification-owner',
        fresh ? 'fresh' : 'stale',
      ),
      adapterTested: stage(
        passed ? 'pass' : 'fail',
        'fixed-fixture-adapter-replay',
        'executed-independent-byte-oracle',
        fresh ? 'fresh' : 'stale',
      ),
      hostTested: notRun('installed-client-hook-behavior'),
      boundaryTested: notRun('protected-host-or-guest-boundary'),
      baseline: publicPath(baseline),
      adapter: publicPath(adapter),
      developerOnly: true,
      launchAllowed: false,
      notRun: [
        'real-provider',
        'authentication',
        'native-approval',
        'nested-protection',
        'guest-network',
        'competitor-benchmark',
        'protected-session-performance',
      ],
      historyIntegrity: 'report-only-no-persisted-chain-assessed',
      eventCoverage: 'selected-fixed-fixture-events-only',
    });
    if (Buffer.byteLength(JSON.stringify(report)) > 32768) throw Error('provider-report-budget');
    const proof = Object.freeze({});
    proofs.set(proof, {
      hash: sha(Buffer.from(JSON.stringify(report))),
      binding: bindingKey(binding),
      passed,
      observedAt: report.observedAt,
    });
    return Object.freeze({ report, proof });
  } finally {
    for (const bytes of [...baseline.privatePolicies, ...adapter.privatePolicies]) bytes.fill(0);
  }
}

/** Assess freshness and private execution provenance; imported receipts remain untrusted.
 * @param {object} report Candidate metadata report. @param {object} currentBinding Current observed dependencies.
 * @param {object|undefined} proof Private result of the actual fixed harness.
 * @param {number} now Owner clock for freshness assessment.
 * @returns {object} Non-authorizing stage assessment. @since v0.17.0 */
export function assessProviderEvidence(report, currentBinding, proof, now = Date.now()) {
  let freshness,
    trusted = false;
  try {
    const keys = [
      'schemaVersion',
      'provider',
      'adapterVersion',
      'observedAt',
      'binding',
      'sourceHashes',
      'configured',
      'adapterTested',
      'hostTested',
      'boundaryTested',
      'baseline',
      'adapter',
      'developerOnly',
      'launchAllowed',
      'notRun',
      'historyIntegrity',
      'eventCoverage',
    ];
    if (
      !exact(report, keys) ||
      report.schemaVersion !== 1 ||
      report.launchAllowed !== false ||
      report.developerOnly !== true ||
      !validBinding(report.binding) ||
      !validBinding(currentBinding) ||
      report.provider !== report.binding.provider ||
      report.adapterVersion !== report.binding.adapterVersion ||
      !['configured', 'adapterTested', 'hostTested', 'boundaryTested'].every((key) =>
        validStage(report[key]),
      ) ||
      !Array.isArray(report.sourceHashes) ||
      report.sourceHashes.length !== 8 ||
      !report.sourceHashes.every(
        (row) =>
          exact(row, ['module', 'rawSha256', 'lfSha256']) &&
          typeof row.module === 'string' &&
          row.module.length <= 128 &&
          hex(row.rawSha256) &&
          hex(row.lfSha256),
      ) ||
      !Number.isSafeInteger(report.observedAt) ||
      !Number.isSafeInteger(now) ||
      Buffer.byteLength(JSON.stringify(report)) > 32768
    )
      throw Error('invalid');
    freshness =
      now >= report.observedAt &&
      report.configured.freshness === 'fresh' &&
      report.adapterTested.freshness === 'fresh' &&
      now - report.observedAt <= 900000 &&
      bindingKey(report.binding) === bindingKey(currentBinding)
        ? 'fresh'
        : 'stale';
    const recorded = proofs.get(proof);
    trusted =
      freshness === 'fresh' &&
      !!recorded?.passed &&
      recorded.observedAt === report.observedAt &&
      recorded.binding === bindingKey(currentBinding) &&
      recorded.hash === sha(Buffer.from(JSON.stringify(report)));
  } catch {
    freshness = 'invalid';
  }
  return freeze({
    schemaVersion: 1,
    freshness,
    configured: stage('reported-only', 'generated-local-policy', 'candidate-report', freshness),
    adapterTested: stage(
      trusted ? 'pass' : 'untrusted',
      'fixed-fixture-adapter-replay',
      trusted ? 'process-private-observation' : 'candidate-report',
      freshness,
    ),
    hostTested: notRun('installed-client-hook-behavior'),
    boundaryTested: notRun('protected-host-or-guest-boundary'),
    trustedFixtureObservation: trusted,
    launchAllowed: false,
  });
}
