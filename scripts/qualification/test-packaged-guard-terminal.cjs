'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawn, execFileSync } = require('node:child_process');
const {
  uniformCRLFCheckout,
  bindSourceToBlob,
  quoteFixturePath,
  settleOwnedProcesses,
} = require('./packaged-guard-terminal.cjs');

test(
  'PowerShell parser preserves safe path metacharacters and rejects alternate quote hazards',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    for (const char of [
      '\u2018',
      '\u2019',
      '\u201a',
      '\u201b',
      '\u201c',
      '\u201d',
      '\u201e',
      '\u201f',
      '\u2028',
      '\u0000',
    ])
      assert.throws(
        () => quoteFixturePath('C:\\fixture\\bad' + char + 'path'),
        /Unsupported qualification path/,
      );
    const expected = 'C:\\fixture\\space \' & $d `x ; | "quoted"\\';
    const source = 'Test-Path -LiteralPath ' + quoteFixturePath(expected);
    const parser = `
$ProgressPreference = 'SilentlyContinue'
$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))
$tokens = $null; $errors = $null
$tree = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
$commands = @($tree.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]}, $true))
if ($errors.Count -ne 0 -or $commands.Count -ne 1 -or $commands[0].CommandElements.Count -ne 3) { exit 2 }
$e = $commands[0].CommandElements
@{name=$e[0].Value; parameter=$e[1].ParameterName; value=$e[2].Value} | ConvertTo-Json -Compress
`;
    const powershell = path.join(
      process.env.SystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const text = execFileSync(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(parser, 'utf16le').toString('base64'),
      ],
      {
        input: Buffer.from(source, 'utf8').toString('base64') + '\n',
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      },
    );
    assert.deepEqual(JSON.parse(text), {
      name: 'Test-Path',
      parameter: 'LiteralPath',
      value: expected,
    });
  },
);

test('accepts only a uniform LF-to-CRLF conversion of the exact Git blob', () => {
  const blob = Buffer.from('one\ntwo\n');
  assert.equal(uniformCRLFCheckout(blob, Buffer.from('one\r\ntwo\r\n')), true);
  assert.equal(uniformCRLFCheckout(blob, Buffer.from('one\r\ntwo\n')), false);
  assert.equal(uniformCRLFCheckout(blob, Buffer.from('one\r\nchanged\r\n')), false);
  assert.equal(
    uniformCRLFCheckout(Buffer.from('one\r\ntwo\n'), Buffer.from('one\r\ntwo\r\n')),
    false,
  );
});

test('refuses an archive and checkout that agree with each other but differ from HEAD', () => {
  const blob = Buffer.from('committed\n');
  const dirty = Buffer.from('different\n');
  assert.throws(() => bindSourceToBlob(dirty, dirty, blob), /canonical Git blob/);
  assert.deepEqual(bindSourceToBlob(blob, Buffer.from('committed\r\n'), blob), {
    archiveNormalization: 'none',
    checkoutNormalization: 'uniform-lf-to-crlf',
  });
});

test('after failure waits for the held witness before settling the owned shell', async () => {
  const events = [];
  let finishWitness,
    finishShell,
    shellClosed = false;
  const witnessResult = new Promise((resolve) => {
    finishWitness = resolve;
  });
  const shellResult = new Promise((resolve) => {
    finishShell = resolve;
  });
  const pending = settleOwnedProcesses({
    shellResult,
    witnessResult,
    gateOpened: true,
    witnessDeadline: performance.now() + 2000,
    shellWaitMs: 0,
    closeWaitMs: 100,
    isShellClosed: () => shellClosed,
    stopWitness: () => events.push('witness-killed'),
    stopShell: () => {
      events.push('shell-killed');
      shellClosed = true;
      finishShell({ code: null });
    },
    readWitness: async () => {
      events.push('witness-read');
      return { identified: true, gone: true };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(events, []);
  finishWitness({ code: 0 });
  const result = await pending;
  assert.deepEqual(events, ['witness-read', 'shell-killed']);
  assert.equal(result.confirmed, true);
  assert.equal(result.witnessTerminationRequested, false);
});

test('reports unknown cleanup when the witness never identifies the broker', async () => {
  const result = await settleOwnedProcesses({
    shellResult: Promise.resolve({ code: 0 }),
    witnessResult: Promise.resolve({ code: 2 }),
    gateOpened: true,
    witnessDeadline: performance.now() + 1000,
    isShellClosed: () => true,
    stopShell: () => {
      throw Error('unexpected');
    },
    stopWitness: () => {
      throw Error('unexpected');
    },
    readWitness: async () => ({ identified: false, gone: false }),
  });
  assert.equal(result.shellSettled, true);
  assert.equal(result.witnessSettled, true);
  assert.equal(result.brokerIdentified, false);
  assert.equal(result.confirmed, false);
});

test('retains the witness until its deadline and records missing proof as unknown', async () => {
  let resolveWitness,
    stopped = false;
  const witnessResult = new Promise((resolve) => {
    resolveWitness = resolve;
  });
  const result = await settleOwnedProcesses({
    shellResult: Promise.resolve({ code: 0 }),
    witnessResult,
    gateOpened: true,
    witnessDeadline: performance.now() + 30,
    shellWaitMs: 0,
    closeWaitMs: 100,
    isShellClosed: () => true,
    stopShell: () => {
      throw Error('unexpected');
    },
    stopWitness: () => {
      stopped = true;
      resolveWitness({ code: null });
    },
    readWitness: async () => {
      throw Error('missing');
    },
  });
  assert.equal(stopped, true);
  assert.equal(result.witnessTerminationRequested, true);
  assert.equal(result.brokerGone, false);
  assert.equal(result.confirmed, false);
});

test('failure settles real owned subprocesses and preserves an unidentified broker as unknown', async () => {
  const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot };
  const shell = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  const witness = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(2), 50)'], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  let closed = false;
  const shellResult = new Promise((resolve, reject) => {
    shell.once('error', reject);
    shell.once('close', (code, signal) => {
      closed = true;
      resolve({ code, signal });
    });
  });
  const witnessResult = new Promise((resolve, reject) => {
    witness.once('error', reject);
    witness.once('close', (code, signal) => resolve({ code, signal }));
  });
  try {
    const result = await settleOwnedProcesses({
      shellResult,
      witnessResult,
      gateOpened: true,
      witnessDeadline: performance.now() + 5000,
      shellWaitMs: 0,
      closeWaitMs: 3000,
      isShellClosed: () => closed,
      stopShell: () => shell.kill(),
      stopWitness: () => witness.kill(),
      readWitness: async () => ({ identified: false, gone: false }),
    });
    assert.equal(result.shellTerminationRequested, true);
    assert.equal(result.shellSettled, true);
    assert.equal(result.witnessSettled, true);
    assert.equal(result.witnessExitCode, 2);
    assert.equal(result.confirmed, false);
  } finally {
    if (!closed) shell.kill();
    if (witness.exitCode === null && witness.signalCode === null) witness.kill();
  }
});
