import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { normalizeExternalReport } = require('../../src/main/static-import-normalize');
const { handleStaticImportCLI } = require('../../src/main/static-import-cli');
const { scanStaticDirectory } = require('../../src/main/static-analysis');
const sha = (value) => createHash('sha256').update(value).digest('hex');

function report() {
  return {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'cfgaudit',
            version: '1.14.0',
            rules: [{ id: 'CFG001', helpUri: 'https://PRIVATE.invalid/rule' }],
          },
        },
        results: [
          {
            ruleId: 'CFG001',
            level: 'error',
            message: { text: 'PRIVATE_MESSAGE_WITH_SECRET' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: '.claude/settings.json' },
                  region: { startLine: 2, snippet: { text: 'PRIVATE_SNIPPET' } },
                },
              },
            ],
            properties: { owasp_llm: 'LLM06', ave_id: 'PRIVATE_AVE' },
          },
        ],
      },
    ],
  };
}

const context = () => ({
  root: '/selected',
  files: new Map([
    ['.claude/settings.json', { path: '.claude/settings.json', sha256: 'a'.repeat(64) }],
  ]),
  baseline: null,
});

describe('cfgaudit SARIF offline projection', () => {
  it('binds observed relative config paths and removes messages, metadata and secret text', () => {
    const result = normalizeExternalReport('cfgaudit-sarif', report(), context());
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      confidence: 'external-unverified',
      severity: 'high',
      category: 'policy_violation',
      analyzer: 'static',
      ruleIdSha256: sha('CFG001'),
      origin: { runIndex: 0, recordIndex: 0 },
      locations: [{ path: '.claude/settings.json', reportedLine: 2, binding: 'current-path-only' }],
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'external-reported-root-not-reported',
        'external-execution-status-not-reported',
        'external-execution-coverage-unverified',
      ]),
    );
    expect(result.coverage).toBe('not-verified');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(JSON.stringify(result)).not.toContain('CFG001');
  });

  it.each([
    ['../outside.json', null],
    ['%2e%2e/outside.json', null],
    ['/selected/.claude/settings.json', '.claude/settings.json'],
    ['/selected-other/.claude/settings.json', null],
    ['/selected/../outside.json', null],
    ['C:/outside.json', null],
    ['file:///outside.json', null],
    ['https://PRIVATE.invalid/secret', null],
    ['.claude/settings.json?token=PRIVATE', null],
    ['.claude%2Fsettings.json', '.claude/settings.json'],
  ])('maps only a safe observed relative URI %s', (uri, expected) => {
    const value = report();
    value.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri = uri;
    const result = normalizeExternalReport('cfgaudit-sarif', value, context());
    expect(result.findings[0].locations[0].path).toBe(expected);
    if (!expected) expect(result.issues).toContain('external-location-unbound');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('binds a native Windows absolute URI only under the caller-selected root', () => {
    const value = report();
    const artifact = value.runs[0].results[0].locations[0].physicalLocation.artifactLocation;
    const selected = context();
    selected.root = 'C:\\Selected';
    artifact.uri = 'c:\\selected\\.claude\\settings.json';
    const mapped = normalizeExternalReport('cfgaudit-sarif', value, selected);
    expect(mapped.findings[0].locations[0].path).toBe('.claude/settings.json');
    artifact.uri = 'C:\\Selected-Other\\.claude\\settings.json';
    const outside = normalizeExternalReport('cfgaudit-sarif', value, selected);
    expect(outside.findings[0].locations[0].path).toBeNull();
    expect(JSON.stringify(outside)).not.toContain('Selected-Other');
  });

  it.each(['uri-base', 'artifact-index', 'run-base'])('does not resolve %s indirection', (kind) => {
    const value = report();
    const run = value.runs[0];
    const artifact = run.results[0].locations[0].physicalLocation.artifactLocation;
    if (kind === 'uri-base') artifact.uriBaseId = '%SRCROOT%';
    if (kind === 'artifact-index') artifact.index = 0;
    if (kind === 'run-base') run.originalUriBaseIds = { '%SRCROOT%': { uri: '/selected/' } };
    const result = normalizeExternalReport('cfgaudit-sarif', value, context());
    expect(result.findings[0].locations[0].path).toBeNull();
    expect(result.issues).toContain('external-location-base-unresolved');
  });

  it('retains unsupported and unregistered findings as review evidence', () => {
    const value = report();
    Object.assign(value.runs[0].results[0], {
      ruleId: 'PRIVATE_RULE',
      level: 'PRIVATE_LEVEL',
      suppressions: [{ status: 'accepted' }],
      baselineState: 'absent',
      codeFlows: [{ private: true }],
    });
    const result = normalizeExternalReport('cfgaudit-sarif', value, context());
    expect(result.findings[0]).toMatchObject({ severity: 'unknown', category: 'unknown' });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'external-rule-unresolved',
        'external-severity-unknown',
        'external-result-suppressed',
        'external-baseline-only-result',
        'external-flow-details-not-imported',
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it.each([
    ['warning', 'medium'],
    ['note', 'low'],
  ])('projects the upstream %s level to %s', (level, expected) => {
    const value = report();
    value.runs[0].results[0].level = level;
    expect(normalizeExternalReport('cfgaudit-sarif', value, context()).findings[0].severity).toBe(
      expected,
    );
  });

  it('caps results and keeps an explicit truncation gap', () => {
    const value = report();
    value.runs[0].results = Array.from({ length: 1025 }, () => value.runs[0].results[0]);
    const result = normalizeExternalReport('cfgaudit-sarif', value, context());
    expect(result.findings).toHaveLength(256);
    expect(result.issues).toEqual(
      expect.arrayContaining(['report-entry-limit', 'external-finding-limit']),
    );
  });

  it('keeps an empty export incomplete and rejects other producers or run shapes', () => {
    const empty = report();
    empty.runs[0].results = [];
    const result = normalizeExternalReport('cfgaudit-sarif', empty, context());
    expect(result.findings).toEqual([]);
    expect(result.issues).toContain('external-execution-status-not-reported');
    for (const value of [
      { ...empty, version: '2.0.0' },
      { ...empty, runs: [] },
      { ...empty, runs: [...empty.runs, ...empty.runs] },
      { ...empty, runs: [{ ...empty.runs[0], tool: { driver: { name: 'other' } } }] },
    ])
      expect(() => normalizeExternalReport('cfgaudit-sarif', value, context())).toThrow(
        'external-report-unsupported-shape',
      );
  });
});

describe('cfgaudit SARIF selected-file import', () => {
  let fixture;
  let root;
  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cfgaudit-import-'));
    root = path.join(fixture, 'selected');
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{"permissions":{"allow":[]}}');
  });
  afterEach(() => {
    expect(path.dirname(path.resolve(fixture))).toBe(path.resolve(os.tmpdir()));
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it('pairs a fresh local review and optional hash baseline with an unverified report', async () => {
    const reportFile = path.join(fixture, 'cfgaudit.sarif');
    const baselineFile = path.join(fixture, 'before.json');
    const external = report();
    external.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri = path.join(
      root,
      '.claude',
      'settings.json',
    );
    fs.writeFileSync(reportFile, JSON.stringify(external));
    fs.writeFileSync(baselineFile, JSON.stringify(await scanStaticDirectory('project', root)));
    let output;
    const code = await handleStaticImportCLI(
      [
        '--static-import-json',
        'project',
        root,
        'cfgaudit-sarif',
        reportFile,
        '--baseline',
        baselineFile,
      ],
      (text) => {
        output = JSON.parse(text);
      },
    );
    expect(code).toBe(2);
    expect(output).toMatchObject({
      safety: 'not-determined',
      reviewRequired: true,
      complete: false,
      external: {
        contract: { id: 'cfgaudit-sarif', version: 1 },
        source: { authenticity: 'unverified', execution: 'not-observed' },
        baseline: { status: 'matching-observed-files' },
      },
    });
    expect(output.external.findings[0].locations[0]).toMatchObject({
      path: '.claude/settings.json',
      binding: 'matched-baseline-file',
    });
    expect(output.external.issues).toContain('external-reported-root-not-reported');
    expect(JSON.stringify(output)).not.toContain('PRIVATE');
  });
});
