import { beforeAll, expect, it } from 'vitest';
import {
  qualifyProviderReplay,
  assessProviderEvidence,
} from '../../scripts/qualification/provider-replay-evidence.mjs';
import { qualifyProviderAdapters } from '../../scripts/qualification/qualify-provider-adapters.mjs';
import { createLoadedSourceBaseline } from '../../scripts/qualification/provider-replay-runner.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
let observed;
beforeAll(async () => {
  observed = await qualifyProviderReplay('codex');
});

it.each(['corpus', 'metrics'])(
  'refuses cached ESM %s after its disposable source changes before issuer loading',
  async (name) => {
    const parent = await fs.realpath(os.tmpdir());
    const root = await fs.mkdtemp(path.join(parent, 'aegis-provider-esm-'));
    const names = [
      ...[
        'action-policy',
        'action-policy-session',
        'provider-adapter-common',
        'provider-codex-adapter',
        'provider-claude-adapter',
      ].map((item) => `src/main/${item}.js`),
      ...['corpus', 'metrics', 'runner', 'evidence'].map(
        (item) => `scripts/qualification/provider-replay-${item}.mjs`,
      ),
    ];
    const require = createRequire(import.meta.url);
    try {
      for (const file of names) {
        const bytes = await fs.readFile(new URL('../../' + file, import.meta.url));
        expect(bytes.length).toBeLessThanOrEqual(65536);
        await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await fs.writeFile(path.join(root, file), bytes, { flag: 'wx' });
      }
      const helper = path.join(root, `scripts/qualification/provider-replay-${name}.mjs`);
      await import(/* @vite-ignore */ pathToFileURL(helper).href);
      await fs.appendFile(helper, '\nthrow Error("changed source must not execute");\n');
      const issuer = await import(
        /* @vite-ignore */ pathToFileURL(
          path.join(root, 'scripts/qualification/provider-replay-evidence.mjs'),
        ).href
      );
      const { report, proof } = await issuer.qualifyProviderReplay('codex');
      expect(report.adapterTested.freshness).toBe('stale');
      expect(issuer.assessProviderEvidence(report, report.binding, proof).freshness).toBe('stale');
      expect(
        issuer.assessProviderEvidence(report, report.binding, proof).trustedFixtureObservation,
      ).toBe(false);
    } finally {
      for (const file of names.filter((file) => file.endsWith('.js')))
        delete require.cache[path.join(root, file)];
      expect(path.dirname(root)).toBe(parent);
      expect((await fs.lstat(root)).isSymbolicLink()).toBe(false);
      await fs.rm(root, { recursive: true });
    }
  },
);

it('detects changed source after loading and refuses unknown cached bodies using only disposable files', async () => {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'aegis-provider-source-'));
  const source = path.join(root, 'selected.cjs');
  const require = createRequire(import.meta.url);
  try {
    await fs.writeFile(source, 'module.exports = 1;');
    const baseline = createLoadedSourceBaseline([pathToFileURL(source)]);
    expect(require(source)).toBe(1);
    expect(baseline()).toBe(true);
    await fs.writeFile(source, 'module.exports = 2;');
    expect(require(source)).toBe(1);
    expect(baseline()).toBe(false);
    expect(createLoadedSourceBaseline([pathToFileURL(source)], true)()).toBe(false);
    await fs.unlink(source);
    expect(baseline()).toBe(false);
  } finally {
    delete require.cache[source];
    expect(path.dirname(root)).toBe(parent);
    expect((await fs.lstat(root)).isSymbolicLink()).toBe(false);
    await fs.rm(root, { recursive: true });
  }
});

it('executes both exact fixed corpora and preserves empirical samples, false claims, and unsuccessful recovery admissions', () => {
  const { report, proof } = observed;
  for (const path of [report.baseline, report.adapter]) {
    expect(path.metrics).toMatchObject({
      scenarioDenominator: 14,
      scenarioPasses: 14,
      taskDenominator: 7,
      taskSuccesses: 4,
      falseRefusalDenominator: 3,
      falseRefusals: 0,
      approvalRequests: 1,
      observedEffects: 6,
      falseCompletionClaims: 1,
    });
    expect(path.metrics.samples).toHaveLength(14);
    expect(path.metrics.p95Ms).toBeGreaterThanOrEqual(path.metrics.p50Ms);
    expect(path.metrics.cpu.userMs).toBeGreaterThanOrEqual(0);
    expect(path.metrics.memory.maxRssBytes).toBeGreaterThan(0);
    expect(path.recovery).toMatchObject({
      passed: true,
      admissionDenominator: 2,
      successfulAdmissions: 1,
      freshOwnerRequired: true,
      failedExchange: { responseLost: true, observedEffect: true },
    });
    expect(path.recovery.admissions.map((entry) => entry.observedEffect)).toEqual([false, true]);
  }
  expect(assessProviderEvidence(report, report.binding, proof)).toMatchObject({
    trustedFixtureObservation: true,
    freshness: 'fresh',
    launchAllowed: false,
  });
  expect(report.hostTested.result).toBe('not-run');
  expect(report.boundaryTested.result).toBe('not-run');
});

it('never upgrades serialized report success or matching hashes into trusted evidence', () => {
  const report = JSON.parse(JSON.stringify(observed.report));
  expect(assessProviderEvidence(report, report.binding, {}).trustedFixtureObservation).toBe(false);
  expect(
    assessProviderEvidence(report, report.binding, JSON.parse(JSON.stringify(observed.proof)))
      .trustedFixtureObservation,
  ).toBe(false);
  report.adapterTested.result = 'pass';
  report.hostTested.result = 'pass';
  expect(
    assessProviderEvidence(report, report.binding, observed.proof).trustedFixtureObservation,
  ).toBe(false);
  expect(assessProviderEvidence(report, report.binding, observed.proof).hostTested.result).toBe(
    'not-run',
  );
});

it.each(['clientSha256', 'helperSha256', 'adapterSha256', 'policySha256', 'corpusSha256'])(
  'invalidates otherwise same-version evidence after %s changes',
  (key) => {
    const current = { ...observed.report.binding, [key]: '0'.repeat(64) };
    expect(assessProviderEvidence(observed.report, current, observed.proof)).toMatchObject({
      freshness: 'stale',
      trustedFixtureObservation: false,
    });
  },
);

it('rejects missing dependencies, unknown schema, cross-provider substitution and expired evidence', () => {
  const missing = { ...observed.report.binding };
  delete missing.helperSha256;
  expect(assessProviderEvidence(observed.report, missing, observed.proof).freshness).toBe(
    'invalid',
  );
  expect(
    assessProviderEvidence(
      { ...observed.report, schemaVersion: 2 },
      observed.report.binding,
      observed.proof,
    ).freshness,
  ).toBe('invalid');
  expect(
    assessProviderEvidence(
      { ...observed.report, adapterTested: { ...observed.report.adapterTested, schemaVersion: 2 } },
      observed.report.binding,
      observed.proof,
    ).freshness,
  ).toBe('invalid');
  expect(
    assessProviderEvidence(
      { ...observed.report, provider: 'claude' },
      observed.report.binding,
      observed.proof,
    ).freshness,
  ).toBe('invalid');
  expect(
    assessProviderEvidence(
      observed.report,
      observed.report.binding,
      observed.proof,
      observed.report.observedAt + 900001,
    ),
  ).toMatchObject({ freshness: 'stale', trustedFixtureObservation: false });
  expect(
    assessProviderEvidence(
      observed.report,
      observed.report.binding,
      observed.proof,
      observed.report.observedAt - 1,
    ).freshness,
  ).toBe('stale');
});

it('runs the separate Claude profile with the same measurable denominator and no provider/configuration selectors', async () => {
  const value = await qualifyProviderAdapters(['claude']);
  expect(value).toMatchObject({
    passed: true,
    launchAllowed: false,
    probe: { result: 'not-selected' },
  });
  expect(value.results[0].report.adapter.metrics.scenarioDenominator).toBe(14);
  expect(JSON.stringify(value)).not.toContain('fixed-dummy-fixture-operation');
  expect(JSON.stringify(value)).not.toContain('dummy-session');
  expect(JSON.stringify(value)).not.toContain('aegis-provider-replay-');
  await expect(qualifyProviderAdapters(['external', '--execute', 'arbitrary'])).rejects.toThrow();
});
