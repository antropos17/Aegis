import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  SCENARIOS,
  ALLOWED,
  createProviderCorpus,
  providerMessage,
  writeProviderPolicy,
  providerCorpusLoadedSha256,
} from './provider-replay-corpus.mjs';
import {
  summarizeProviderSamples,
  providerMetricsLoadedSha256,
} from './provider-replay-metrics.mjs';
const require = createRequire(import.meta.url);

/** Capture bounded selected source bytes before trusted loading; prior cached bodies are unknown.
 * @param {URL[]} files Explicit owner-selected source files. @param {boolean} priorLoaded Unknown cached dependency flag.
 * @returns {() => boolean} Private comparison against current source bytes. @since v0.17.0 */
export function createLoadedSourceBaseline(files, priorLoaded = false) {
  const observe = () => {
    if (!Array.isArray(files) || files.length === 0 || files.length > 16)
      throw Error('provider-source-budget');
    return JSON.stringify(
      files.map((file) => {
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
          throw Error('provider-source-budget');
        const bytes = readFileSync(file);
        if (bytes.length > 65536) throw Error('provider-source-budget');
        return createHash('sha256').update(bytes).digest('hex');
      }),
    );
  };
  let baseline;
  try {
    baseline = observe();
  } catch {
    /* Unknown source never becomes tested evidence. */
  }
  return () => {
    if (priorLoaded || !baseline) return false;
    try {
      return baseline === observe();
    } catch {
      return false;
    }
  };
}
const nativeNames = [
  'action-policy',
  'action-policy-session',
  'provider-adapter-common',
  'provider-codex-adapter',
  'provider-claude-adapter',
];
const priorLoaded = nativeNames.some(
  (name) => require.cache[require.resolve(`../../src/main/${name}`)],
);
const loadedSourceMatches = createLoadedSourceBaseline(
  [
    ...nativeNames.map((name) => new URL(`../../src/main/${name}.js`, import.meta.url)),
    ...['corpus', 'runner', 'metrics', 'evidence'].map(
      (name) => new URL(`./provider-replay-${name}.mjs`, import.meta.url),
    ),
  ],
  priorLoaded,
);
const { createCodexAdapter } = require('../../src/main/provider-codex-adapter');
const { createClaudeAdapter } = require('../../src/main/provider-claude-adapter');
const loadedAtInitialization = loadedSourceMatches();

/** Check the original bounded loading observation; unknown preexisting CJS cache fails closed.
 * @returns {boolean} Whether observed source still matches the initial load boundary. @since v0.17.0 */
export function providerLoadedSourceCurrent() {
  try {
    return (
      loadedAtInitialization &&
      loadedSourceMatches() &&
      [
        ['corpus', providerCorpusLoadedSha256],
        ['metrics', providerMetricsLoadedSha256],
      ].every(([name, initial]) => {
        if (!initial) return false;
        const bytes = readFileSync(new URL(`./provider-replay-${name}.mjs`, import.meta.url));
        return (
          bytes.length <= 65536 && createHash('sha256').update(bytes).digest('hex') === initial
        );
      })
    );
  } catch {
    return false;
  }
}
const factory = (provider, policyPath, cwd) =>
  (provider === 'codex' ? createCodexAdapter : createClaudeAdapter)({
    policyPath,
    cwd,
    sessionId: 'dummy-session',
  });
const mutate = (raw, field, value) => {
  const input = JSON.parse(raw);
  input[field] = value;
  return Buffer.from(JSON.stringify(input));
};

/** Execute the same harmless corpus through direct fixture or actual adapter decisions.
 * @param {string} provider Fixed provider. @param {boolean} adapted Actual adapter path selector.
 * @returns {Promise<object>} Independent sentinels, monotonic measurements and private policy hash inputs. @since v0.17.0 */
export async function runProviderPath(provider, adapted) {
  const fixture = await createProviderCorpus();
  const owners = [];
  try {
    const policies = {};
    for (const decision of ['allow', 'ask', 'deny'])
      policies[decision] = await writeProviderPolicy(fixture.root, decision);
    const samples = [];
    const cpuStart = process.cpuUsage();
    for (const scenario of SCENARIOS) {
      const started = performance.now();
      const policyDecision =
        scenario === 'pending'
          ? 'ask'
          : scenario === 'deny' || scenario === 'mismatched-input'
            ? 'deny'
            : 'allow';
      const adapter = adapted
        ? factory(provider, policies[policyDecision].policyPath, fixture.root)
        : null;
      if (adapter) owners.push(adapter);
      let request = providerMessage(provider, fixture.root, scenario);
      if (scenario === 'invalid-hook') request = Buffer.from('{invalid');
      if (scenario === 'mismatched-identity')
        request = mutate(request, 'session_id', 'other-session');
      if (scenario === 'mismatched-input')
        request = mutate(request, 'tool_input', { command: 'substituted-not-executed' });
      let decision = policyDecision,
        completionLinked = false,
        secondRejected = null;
      const missingEvent = ['missing-hook', 'timed-out-hook', 'lost-response'].includes(scenario);
      if (scenario === 'timed-out-hook') {
        // Fixed delivery fault, not an installed provider or evaluator timeout claim.
        await new Promise((resolve) => setTimeout(resolve, 10));
        adapter?.close();
        decision = 'deny';
      } else if (scenario === 'missing-hook') {
        adapter?.close();
        decision = 'deny';
      } else if (adapter) decision = (await adapter.before(request)).decision;
      else if (['invalid-hook', 'mismatched-identity', 'mismatched-input'].includes(scenario))
        decision = 'deny';
      let responseLost = false;
      if (decision === 'allow' && scenario !== 'false-completion') {
        try {
          await fixture.receive(scenario);
        } catch {
          responseLost = true;
          adapter?.close();
        }
      }
      const providerReportedCompletion = !missingEvent && decision === 'allow';
      const completion = providerMessage(provider, fixture.root, scenario, true);
      if (scenario === 'late-completion') adapter?.close();
      if (providerReportedCompletion) {
        completionLinked = adapter
          ? adapter.after(completion).status === 'linked'
          : scenario !== 'late-completion';
        if (scenario === 'duplicate-completion')
          secondRejected = adapter ? adapter.after(completion).status === 'rejected' : true;
      }
      const observed = await fixture.observe(scenario);
      const expectedEffect = ALLOWED.includes(scenario) && scenario !== 'false-completion';
      const observedEffect = observed.present && observed.bytesMatch;
      const falseClaimDetected =
        scenario === 'false-completion' && providerReportedCompletion && !observedEffect;
      const passed =
        observed.present === expectedEffect &&
        (!observed.present || observed.bytesMatch) &&
        (!expectedEffect || decision === 'allow') &&
        (scenario !== 'pending' || decision === 'ask') &&
        (scenario !== 'duplicate-completion' || (completionLinked && secondRejected === true)) &&
        (scenario !== 'late-completion' || !completionLinked) &&
        (scenario !== 'lost-response' || responseLost) &&
        (scenario !== 'false-completion' || falseClaimDetected);
      const memory = process.memoryUsage();
      samples.push(
        Object.freeze({
          scenario,
          durationMs: performance.now() - started,
          decision,
          taskRequested: ALLOWED.includes(scenario),
          taskSucceeded: observedEffect && completionLinked,
          observedEffect,
          providerReportedCompletion,
          completionLinked,
          falseClaimDetected,
          missingEvent,
          lateEvent: scenario === 'late-completion',
          secondRejected,
          passed,
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
        }),
      );
      request.fill(0);
      completion.fill(0);
      adapter?.close();
    }
    const metrics = summarizeProviderSamples(samples, process.cpuUsage(cpuStart));
    const recovery = await recover(provider, adapted, fixture, policies.allow.policyPath, owners);
    const policyFresh = (
      await Promise.all(
        Object.values(policies).map(async (policy) =>
          (await fs.readFile(policy.policyPath)).equals(policy.bytes),
        ),
      )
    ).every(Boolean);
    return {
      configuration: adapted
        ? 'selected-adapter-with-existing-policy-session'
        : 'direct-fixed-fixture',
      metrics,
      recovery,
      policyFresh,
      privatePolicies: Object.values(policies).map((policy) => policy.bytes),
    };
  } finally {
    for (const owner of owners) owner.close();
    await fixture.cleanup();
  }
}

async function recover(provider, adapted, fixture, policyPath, owners) {
  let owner = adapted ? factory(provider, policyPath, fixture.root) : null;
  if (owner) owners.push(owner);
  const admit = async (id, selected, closed) => {
    const raw = providerMessage(provider, fixture.root, id);
    try {
      return selected ? (await selected.before(raw)).decision : closed ? 'deny' : 'allow';
    } finally {
      raw.fill(0);
    }
  };
  const failedStart = performance.now();
  let lost = false;
  if ((await admit('recovery-failed', owner, false)) === 'allow') {
    try {
      await fixture.receive('recovery-failed');
    } catch {
      lost = true;
      owner?.close();
    }
  }
  const failedMs = performance.now() - failedStart;
  const failedObserved = await fixture.observe('recovery-failed');
  const staleStart = performance.now();
  const staleDecision = await admit('recovery-stale', owner, true);
  if (staleDecision === 'allow') await fixture.receive('recovery-stale');
  const staleMs = performance.now() - staleStart,
    staleObserved = await fixture.observe('recovery-stale');
  owner = adapted ? factory(provider, policyPath, fixture.root) : null;
  if (owner) owners.push(owner);
  const freshStart = performance.now();
  const freshDecision = await admit('recovery-fresh', owner, false);
  if (freshDecision === 'allow') await fixture.receive('recovery-fresh');
  const freshMs = performance.now() - freshStart,
    freshObserved = await fixture.observe('recovery-fresh');
  return Object.freeze({
    scope: 'local-fixture-injected-loss',
    failedExchange: {
      responseLost: lost,
      observedEffect: failedObserved.present && failedObserved.bytesMatch,
      durationMs: failedMs,
    },
    admissionDenominator: 2,
    successfulAdmissions:
      Number(staleObserved.present && staleObserved.bytesMatch) +
      Number(freshObserved.present && freshObserved.bytesMatch),
    freshOwnerRequired: true,
    admissions: [
      {
        owner: 'closed-original',
        decision: staleDecision,
        observedEffect: staleObserved.present,
        durationMs: staleMs,
      },
      {
        owner: 'fresh',
        decision: freshDecision,
        observedEffect: freshObserved.present && freshObserved.bytesMatch,
        durationMs: freshMs,
      },
    ],
    passed:
      lost &&
      failedObserved.bytesMatch &&
      staleDecision === 'deny' &&
      !staleObserved.present &&
      freshDecision === 'allow' &&
      freshObserved.bytesMatch,
  });
}
