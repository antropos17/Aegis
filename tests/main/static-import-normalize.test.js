import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { normalizeExternalReport } = require('../../src/main/static-import-normalize');
const hash = 'a'.repeat(64);
const context = () => ({
  root: '/selected',
  files: new Map([
    ['run.py', { path: 'run.py', sha256: hash }],
    ['space name.py', { path: 'space name.py', sha256: hash }],
  ]),
  baseline: null,
});
const skill = (overrides = {}) => ({
  skill_path: '/selected',
  findings_count: 1,
  analyzers_used: ['behavioral_analyzer'],
  findings: [
    {
      rule_id: 'RULE',
      severity: 'HIGH',
      category: 'data_exfiltration',
      analyzer: 'behavioral',
      file_path: 'run.py',
      line_number: 2,
    },
  ],
  ...overrides,
});
const sarif = () => ({
  version: '2.1.0',
  runs: [
    {
      tool: { driver: { name: 'skill-scanner', version: '1.2.3-PRIVATE-BUILD', rules: [] } },
      invocations: [{ executionSuccessful: true }],
      results: [
        {
          ruleId: 'RULE',
          level: 'error',
          properties: { category: 'data_exfiltration', severity: 'CRITICAL' },
          message: { text: 'PRIVATE_MESSAGE' },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'run.py', uriBaseId: '%SRCROOT%' },
                region: { startLine: 2, snippet: { text: 'PRIVATE_SNIPPET' } },
              },
            },
          ],
        },
      ],
    },
  ],
});
const mcp = () => ({
  server_url: 'https://PRIVATE_HOST.invalid/?token=PRIVATE_TOKEN',
  requested_analyzers: ['yara'],
  scan_results: [
    {
      item_type: 'tool',
      tool_name: 'PRIVATE_TOOL',
      tool_description: 'PRIVATE_TEXT',
      status: 'completed',
      is_safe: false,
      findings: {
        yara_analyzer: {
          severity: 'HIGH',
          total_findings: 3,
          threat_summary: 'PRIVATE_SUMMARY',
          threat_names: ['PRIVATE_THREAT'],
        },
      },
    },
  ],
});
const normalize = (format, value, ctx = context()) => normalizeExternalReport(format, value, ctx);

describe('external result projection', () => {
  it('uses fixed categories, severities and analyzer names for unknown input', () => {
    const value = skill();
    Object.assign(value.findings[0], {
      severity: 'PRIVATE_LEVEL',
      category: 'PRIVATE_CATEGORY',
      analyzer: 'PRIVATE_ENGINE',
      rule_id: 'PRIVATE_RULE',
    });
    value.analyzers_used = ['PRIVATE_ANALYZER'];
    const result = normalize('cisco-skill-json', value);
    expect(result.findings[0]).toMatchObject({
      severity: 'unknown',
      category: 'unknown',
      analyzer: 'unknown',
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'external-severity-unknown',
        'external-category-unknown',
        'external-analyzer-unknown',
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it.each(['LOW', 'INFO', 'MEDIUM', 'CRITICAL'])(
    'preserves a %s finding regardless of upstream safety summary',
    (level) => {
      const value = skill({ is_safe: true, max_severity: 'SAFE' });
      value.findings[0].severity = level;
      expect(normalize('cisco-skill-json', value).findings[0].severity).toBe(level.toLowerCase());
    },
  );

  it('does not hide malformed finding records or inconsistent counts', () => {
    const result = normalize('cisco-skill-json', skill({ findings_count: 0, findings: [null] }));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('unknown');
    expect(result.issues).toContain('reported-count-mismatch');
  });

  it('reports failed and missing analyzers without exposing exception text', () => {
    const result = normalize(
      'cisco-skill-json',
      skill({ analyzers_used: [], analyzers_failed: [{ error: 'PRIVATE_ERROR' }] }),
    );
    expect(result.issues).toEqual(
      expect.arrayContaining(['external-analyzer-failed', 'analyzers-not-reported']),
    );
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('does not map a finding from a different declared skill root', () => {
    const result = normalize('cisco-skill-json', skill({ skill_path: '/another/PRIVATE_ROOT' }));
    expect(result.findings[0].locations[0]).toMatchObject({
      path: null,
      currentSha256: null,
      binding: 'unbound',
    });
    expect(result.issues).toContain('external-reported-root-mismatch');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('matches Windows slash variants without reading a reported absolute path', () => {
    const ctx = context();
    ctx.root = 'X:\\selected';
    expect(
      normalize('cisco-skill-json', skill({ skill_path: 'X:/selected' }), ctx).findings[0]
        .locations[0].path,
    ).toBe('run.py');
  });

  it.each(['cisco-other', '__proto__', 'toString'])(
    'rejects an unknown explicit format %s',
    (format) => {
      expect(() => normalize(format, skill())).toThrow('external-format-unsupported');
    },
  );

  it.each([
    {},
    { results: [] },
    { findings: [] },
    { findings: [], skill_path: '/selected', analyzers_used: null },
  ])('rejects unsupported skill envelopes', (value) => {
    expect(() => normalize('cisco-skill-json', value)).toThrow('external-report-unsupported-shape');
  });
});

describe('Cisco SARIF subset', () => {
  it('preserves critical severity, hashes version suffixes and removes messages', () => {
    const result = normalize('cisco-skill-sarif', sarif());
    expect(result.findings[0]).toMatchObject({
      severity: 'critical',
      locations: [{ path: 'run.py', reportedLine: 2 }],
    });
    expect(result.producerVersionsClaimed[0]).toMatchObject({ core: '1.2.3' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(result.issues).toContain('analyzers-not-reported');
  });

  it('uses rule metadata when the result has none', () => {
    const value = sarif();
    delete value.runs[0].results[0].properties;
    value.runs[0].tool.driver.rules.push({
      id: 'RULE',
      properties: { severity: 'LOW', category: 'policy_violation' },
    });
    expect(normalize('cisco-skill-sarif', value).findings[0]).toMatchObject({
      severity: 'low',
      category: 'policy_violation',
    });
  });

  it.each([
    '../run.py',
    '%2e%2e/run.py',
    '..\\run.py',
    'file:///etc/passwd',
    'https://PRIVATE.invalid/run.py',
    'C:/run.py',
    '//server/run.py',
    'run.py:secret',
    'run.py?token=PRIVATE',
    '%00run.py',
    '%zz',
    '/run.py',
    './run.py',
  ])('leaves unsafe or absolute URI %s unbound', (uri) => {
    const value = sarif();
    value.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri = uri;
    const result = normalize('cisco-skill-sarif', value);
    expect(result.findings[0].locations[0]).toMatchObject({
      path: null,
      currentSha256: null,
      binding: 'unbound',
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('decodes a relative URI to an exact already-observed filename', () => {
    const value = sarif();
    value.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri = 'space%20name.py';
    expect(normalize('cisco-skill-sarif', value).findings[0].locations[0].path).toBe(
      'space name.py',
    );
  });

  it.each(['different-base', 'base-map', 'index'])('does not resolve %s indirection', (mode) => {
    const value = sarif();
    const run = value.runs[0];
    if (mode === 'different-base')
      run.results[0].locations[0].physicalLocation.artifactLocation.uriBaseId = 'PRIVATE_BASE';
    if (mode === 'base-map')
      run.originalUriBaseIds = { '%SRCROOT%': { uri: 'https://PRIVATE.invalid/' } };
    if (mode === 'index') run.results[0].locations[0].physicalLocation.artifactLocation.index = 0;
    const result = normalize('cisco-skill-sarif', value);
    expect(result.findings[0].locations[0].path).toBeNull();
    expect(result.issues).toContain('external-location-base-unresolved');
  });

  it.each([0, -1, 1.5, 10000001, 'PRIVATE_LINE'])('drops invalid reported line %s', (line) => {
    const value = sarif();
    value.runs[0].results[0].locations[0].physicalLocation.region.startLine = line;
    const result = normalize('cisco-skill-sarif', value);
    expect(result.findings[0].locations[0].reportedLine).toBeNull();
    expect(result.issues).toContain('external-line-invalid');
  });

  it('retains suppressed and baseline-only findings and exposes omitted flow data', () => {
    const value = sarif();
    const run = value.runs[0];
    Object.assign(run.results[0], {
      suppressions: [{ status: 'accepted' }],
      baselineState: 'absent',
      codeFlows: [{ PRIVATE_FLOW: true }],
    });
    run.invocations[0] = {
      executionSuccessful: false,
      toolExecutionNotifications: [{ message: { text: 'PRIVATE_FAILURE' } }],
    };
    run.externalPropertyFileReferences = {
      results: [{ location: { uri: 'https://PRIVATE.invalid' } }],
    };
    const result = normalize('cisco-skill-sarif', value);
    expect(result.findings).toHaveLength(1);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'external-result-suppressed',
        'external-baseline-only-result',
        'external-flow-details-not-imported',
        'external-execution-incomplete',
        'external-tool-notifications',
        'external-properties-not-imported',
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('marks a no-result report with no invocation status as incomplete evidence', () => {
    const value = sarif();
    value.runs[0].results = [];
    delete value.runs[0].invocations;
    expect(normalize('cisco-skill-sarif', value).issues).toContain(
      'external-execution-status-not-reported',
    );
  });

  it.each(['2.0.0', '3.0.0'])('rejects SARIF version %s', (version) => {
    expect(() => normalize('cisco-skill-sarif', { ...sarif(), version })).toThrow(
      'external-report-unsupported-shape',
    );
  });

  it('rejects a different SARIF producer', () => {
    const value = sarif();
    value.runs[0].tool.driver.name = 'PRIVATE_SCANNER';
    expect(() => normalize('cisco-skill-sarif', value)).toThrow(
      'external-report-unsupported-shape',
    );
  });
});

describe('MCP raw-envelope aggregates and caps', () => {
  it('retains an aggregate with a reported count and a hashed item identity', () => {
    const result = normalize('cisco-mcp-json', mcp());
    expect(result.findings[0]).toMatchObject({
      kind: 'aggregate',
      severity: 'high',
      reportedCount: 3,
      itemType: 'tool',
      locations: [],
    });
    expect(result.findings[0].itemIdSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.issues).toContain('mcp-source-binding-unavailable');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('does not infer missing analyzer success from a safe flag or empty findings', () => {
    const value = mcp();
    value.scan_results[0].is_safe = true;
    value.scan_results[0].findings = {};
    expect(normalize('cisco-mcp-json', value).issues).toContain(
      'requested-analyzer-result-missing',
    );
  });

  it('exposes failed items and meta filtering without importing their free text', () => {
    const value = mcp();
    value.scan_results[0].status = 'PRIVATE_FAILURE';
    value.scan_results[0].meta_analysis = {
      filtered_count: 2,
      filtered_findings: ['PRIVATE_FILTERED'],
    };
    const result = normalize('cisco-mcp-json', value);
    expect(result.issues).toEqual(
      expect.arrayContaining(['external-execution-incomplete', 'external-meta-filtering-reported']),
    );
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('does not turn contradictory safe aggregates into clean evidence', () => {
    const value = mcp();
    value.scan_results[0].findings.yara_analyzer.severity = 'SAFE';
    const result = normalize('cisco-mcp-json', value);
    expect(result.findings).toHaveLength(1);
    expect(result.issues).toContain('reported-count-severity-mismatch');
  });

  it.each([-1, 1000001, 0.5, 'PRIVATE_COUNT'])('does not propagate invalid count %s', (count) => {
    const value = mcp();
    value.scan_results[0].findings.yara_analyzer.total_findings = count;
    const result = normalize('cisco-mcp-json', value);
    expect(result.findings[0].reportedCount).toBeNull();
    expect(result.issues).toContain('invalid-reported-count');
  });

  it('keeps zero-result exports unverified', () => {
    const value = mcp();
    Object.assign(value.scan_results[0].findings.yara_analyzer, {
      severity: 'SAFE',
      total_findings: 0,
      threat_names: [],
    });
    const result = normalize('cisco-mcp-json', value);
    expect(result.findings).toHaveLength(0);
    expect(result.coverage).toBe('not-verified');
  });

  it.each([[], {}, { scan_results: [], requested_analyzers: [] }])(
    'rejects bare arrays and unsupported MCP envelopes',
    (value) => {
      expect(() => normalize('cisco-mcp-json', value)).toThrow('external-report-unsupported-shape');
    },
  );

  it('caps imported findings and records the truncation', () => {
    const value = skill();
    value.findings = Array.from({ length: 1025 }, () => ({ ...value.findings[0] }));
    value.findings_count = 1025;
    const result = normalize('cisco-skill-json', value);
    expect(result.findings).toHaveLength(256);
    expect(result.issues).toEqual(
      expect.arrayContaining(['external-finding-limit', 'report-entry-limit']),
    );
  });

  it('caps locations and runs without hiding the gap', () => {
    const value = sarif();
    const run = value.runs[0];
    run.results[0].locations = Array.from({ length: 17 }, () => run.results[0].locations[0]);
    value.runs = Array.from({ length: 17 }, () => run);
    const result = normalize('cisco-skill-sarif', value);
    expect(result.findings).toHaveLength(16);
    expect(result.findings[0].locations).toHaveLength(16);
    expect(result.issues).toContain('report-entry-limit');
  });
});
