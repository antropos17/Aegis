import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { handleStaticImportCLI } = require('../../src/main/static-import-cli');
const { scanStaticDirectory } = require('../../src/main/static-analysis');
let fixture;
let root;
let reportFile;
let input;
async function cli(
  args = ['--static-import-json', 'package', root, 'cisco-skill-json', reportFile],
) {
  let output;
  const code = await handleStaticImportCLI(args, (text) => {
    output = JSON.parse(text);
  });
  return { code, ...output };
}
beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-import-cli-'));
  root = path.join(fixture, 'package');
  fs.mkdirSync(root);
  reportFile = path.join(fixture, 'report.json');
  input = {
    skill_path: root,
    analyzers_used: ['static_analyzer'],
    findings_count: 0,
    findings: [],
    is_safe: true,
  };
  fs.writeFileSync(reportFile, JSON.stringify(input));
});
afterEach(() => {
  vi.restoreAllMocks();
  expect(path.dirname(path.resolve(fixture))).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(fixture, { recursive: true, force: true });
});

describe('offline import CLI boundaries', () => {
  it('reads a caller-selected baseline through the CLI option', async () => {
    const before = path.join(fixture, 'before.json');
    fs.writeFileSync(before, JSON.stringify(await scanStaticDirectory('package', root)));
    const result = await cli([
      '--static-import-json',
      'package',
      root,
      'cisco-skill-json',
      reportFile,
      '--baseline',
      before,
    ]);
    expect(result.code).toBe(2);
    expect(result.external.baseline.status).toBe('matching-observed-files');
  });

  it.each(['cisco-skill-sarif', 'cisco-mcp-json'])(
    'imports %s from an explicit offline file',
    async (format) => {
      const document =
        format === 'cisco-skill-sarif'
          ? {
              version: '2.1.0',
              runs: [
                {
                  tool: { driver: { name: 'skill-scanner', version: '1.0.0' } },
                  results: [],
                  invocations: [{ executionSuccessful: true }],
                },
              ],
            }
          : { server_url: 'PRIVATE_TARGET', requested_analyzers: ['yara'], scan_results: [] };
      fs.writeFileSync(reportFile, JSON.stringify(document));
      const result = await cli(['--static-import-json', 'package', root, format, reportFile]);
      expect(result.code).toBe(2);
      expect(result.external.contract).toEqual({ id: format, version: 1 });
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    },
  );

  it('always requires review, including a complete local scan and empty upstream findings', async () => {
    const result = await cli();
    expect(result).toMatchObject({
      code: 2,
      safety: 'not-determined',
      reviewRequired: true,
      complete: false,
      status: 'incomplete',
    });
    expect(result.local.complete).toBe(true);
  });

  it('runs through actual Node main.js without executing package code', () => {
    const marker = path.join(fixture, 'executed');
    fs.writeFileSync(
      path.join(root, 'tool.cjs'),
      'require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "PRIVATE_EXECUTED")',
    );
    input.findings = [
      {
        rule_id: 'PRIVATE_RULE',
        severity: 'HIGH',
        category: 'command_injection',
        analyzer: 'static',
        file_path: 'tool.cjs',
        description: 'PRIVATE_TEXT',
        snippet: 'PRIVATE_TOKEN',
      },
    ];
    input.findings_count = 1;
    fs.writeFileSync(reportFile, JSON.stringify(input));
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../../src/main/main.js'),
        '--static-import-json',
        'package',
        root,
        'cisco-skill-json',
        reportFile,
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).external.findings[0].locations[0].path).toBe('tool.cjs');
    expect(result.stdout).not.toContain('PRIVATE');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it.each(
    [
      ['--static-import-json'],
      ['--static-import-json', 'package'],
      [
        '--static-import-json',
        'package',
        'directory',
        'cisco-skill-json',
        'report',
        '--wrong',
        'baseline',
      ],
      ['--static-import-json', 'package', 'directory', 'cisco-skill-json', 'report', '--baseline'],
      [
        '--static-import-json',
        'package',
        'directory',
        'cisco-skill-json',
        'report',
        '--baseline',
        '--flag',
      ],
    ].map((args) => [args]),
  )('rejects malformed argument sequences', async (args) => {
    expect(await cli(args)).toMatchObject({
      code: 1,
      error: 'expected-static-import-arguments',
      reviewRequired: true,
    });
  });

  it.each([
    '{ "PRIVATE_ERROR":',
    '{"findings":[],"findings":[]}',
    '[' + '{}'.repeat(70),
    '{"bad":"\ud800"}',
  ])('returns fixed parse/shape errors', async (text) => {
    fs.writeFileSync(reportFile, text);
    const result = await cli();
    expect(result.code).toBe(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('rejects oversized input before parsing', async () => {
    fs.writeFileSync(reportFile, JSON.stringify({ private: 'PRIVATE'.repeat(200000) }));
    expect(await cli()).toMatchObject({ code: 1, error: 'external-input-unavailable' });
  });

  it('rejects invalid UTF-8 and excessive JSON depth', async () => {
    fs.writeFileSync(reportFile, Buffer.from([0xff, 0xfe, 0x00]));
    expect((await cli()).code).toBe(1);
    fs.writeFileSync(reportFile, '{"nested":'.repeat(70) + '{}' + '}'.repeat(70));
    expect((await cli()).code).toBe(1);
  });

  it('rejects report storage inside the selected scan tree', async () => {
    const inside = path.join(root, 'report.json');
    fs.copyFileSync(reportFile, inside);
    expect(
      await cli(['--static-import-json', 'package', root, 'cisco-skill-json', inside]),
    ).toMatchObject({ code: 1, error: 'external-input-unavailable' });
  });

  it('does not open a selected report that becomes a link', async () => {
    const original = fs.promises.lstat;
    vi.spyOn(fs.promises, 'lstat').mockImplementation(async (filename, ...args) => {
      if (filename === reportFile) return { isSymbolicLink: () => true };
      return original(filename, ...args);
    });
    const open = vi.spyOn(fs.promises, 'open');
    expect((await cli()).code).toBe(1);
    expect(open.mock.calls.some(([filename]) => filename === reportFile)).toBe(false);
  });

  it('does not expose filesystem errors or unknown adapters', async () => {
    expect(
      await cli(['--static-import-json', 'PRIVATE_ADAPTER', root, 'cisco-skill-json', reportFile]),
    ).toMatchObject({ code: 1, error: 'unsupported-profile' });
    expect(
      await cli([
        '--static-import-json',
        'package',
        path.join(fixture, 'PRIVATE_MISSING'),
        'cisco-skill-json',
        reportFile,
      ]),
    ).toMatchObject({ code: 1, error: 'external-input-unavailable' });
  });
});
