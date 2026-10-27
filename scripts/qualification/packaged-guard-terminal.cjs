'use strict';

// Run in an owned Windows PTY: node packaged-guard-terminal.cjs <candidate-exe> <new-output>
// When prompted, enter the synthetic fixture key aabb-ccdd-eeff-0011-2233-4455.
// No real provider, profile, user data, or owner approval is used.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash, createHmac } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createReadStream } = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');
const { extractFile } = require('@electron/asar');
const { createClaudeGuardLauncher } = require('../../src/main/claude-guard-launch');

const root = path.resolve(__dirname, '../..');
const [exeArg, outputArg] = process.argv.slice(2);
const output = outputArg && path.isAbsolute(outputArg) ? path.resolve(outputArg) : null;
const SESSION = 'a'.repeat(32);
const KEY = 'aabbccddeeff001122334455';
const TOKEN = 'b'.repeat(64);
const receipt = {
  schemaVersion: 1,
  scope: 'packaged-guard-terminal-fake-receiver',
  providerAttempted: false,
  nativeOwnerDialog: false,
  scriptedAdmission: true,
  terminalTranscriptInspected: false,
  events: [],
};
let stage = 'preflight';
let madeOutput = false;
let shell;
let shellClosed = false;

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Accept only an exact whole-file Git LF to checkout CRLF conversion.
 * @param {Buffer} blob Canonical LF Git blob. @param {Buffer} checkout Local source bytes.
 * @returns {boolean} Whether every newline alone was converted. @since v0.21.0 */
function uniformCRLFCheckout(blob, checkout) {
  if (!Buffer.isBuffer(blob) || !Buffer.isBuffer(checkout) || blob.includes(13)) return false;
  const bytes = [];
  for (const byte of blob) {
    if (byte === 10) bytes.push(13);
    bytes.push(byte);
  }
  return Buffer.from(bytes).equals(checkout);
}

/** Bind both archive and checkout bytes to an independently selected Git blob.
 * @param {Buffer} archive Packaged source. @param {Buffer} checkout Local source.
 * @param {Buffer} blob Source committed at HEAD.
 * @returns {object} Fixed newline-normalization labels. @since v0.21.0 */
function bindSourceToBlob(archive, checkout, blob) {
  const normalized = (value) => {
    if (value.equals(blob)) return 'none';
    if (uniformCRLFCheckout(blob, value)) return 'uniform-lf-to-crlf';
    throw Error('Source differs from canonical Git blob');
  };
  return { archiveNormalization: normalized(archive), checkoutNormalization: normalized(checkout) };
}

async function waitBounded(promise, ms) {
  if (!promise) return null;
  let timer;
  try {
    return await Promise.race([
      promise.then(
        (value) => ({ settled: true, fulfilled: true, value }),
        () => ({ settled: true, fulfilled: false, value: null }),
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), Math.max(0, ms));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Settle only owned shell/witness handles; never infer an unobserved broker exit.
 * @param {object} options Owned process outcomes, callbacks and deadlines.
 * @returns {Promise<object>} Fixed cleanup evidence. @since v0.21.0 */
async function settleOwnedProcesses(options) {
  const {
    shellResult,
    witnessResult,
    gateOpened,
    stopShell,
    stopWitness,
    readWitness,
    isShellClosed,
    witnessDeadline,
    shellWaitMs = 2000,
    closeWaitMs = 3000,
  } = options;
  const result = {
    gateOpened,
    shellSettled: false,
    witnessSettled: false,
    shellTerminationRequested: false,
    witnessTerminationRequested: false,
    brokerIdentified: false,
    brokerGone: false,
    confirmed: false,
  };
  const stopOwnedShell = () => {
    if (shellResult && !isShellClosed()) {
      result.shellTerminationRequested = true;
      try {
        stopShell();
      } catch {
        /* Retain unknown settlement. */
      }
    }
  };
  if (!gateOpened) stopOwnedShell();
  let witness = await waitBounded(witnessResult, Math.max(0, witnessDeadline - performance.now()));
  if (witnessResult && !witness) {
    result.witnessTerminationRequested = true;
    try {
      stopWitness();
    } catch {
      /* Retain unknown settlement. */
    }
    witness = await waitBounded(witnessResult, closeWaitMs);
  }
  result.witnessSettled = !!witness;
  if (witness) result.witnessExitCode = witness.value?.code ?? null;
  if (gateOpened && witness) {
    try {
      const proof = await readWitness();
      result.brokerIdentified = proof.identified === true;
      result.brokerGone = proof.identified === true && proof.gone === true;
      result.brokerForced = proof.forced === true;
    } catch {
      /* A missing witness is unknown, not a clean exit. */
    }
  }
  let shell = await waitBounded(shellResult, shellWaitMs);
  if (shellResult && !shell) {
    stopOwnedShell();
    shell = await waitBounded(shellResult, closeWaitMs);
  }
  result.shellSettled = !!shell && isShellClosed();
  if (shell) result.shellExitCode = shell.value?.code ?? null;
  result.confirmed =
    result.shellSettled &&
    (!witnessResult || result.witnessSettled) &&
    (!gateOpened ||
      (result.witnessSettled &&
        result.witnessExitCode === 0 &&
        result.brokerIdentified &&
        result.brokerGone));
  return result;
}
async function processGone(pid) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
async function regular(file) {
  const stat = await fs.lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink());
}
async function unlinkedDirectory(directory) {
  let cursor = path.resolve(directory);
  for (;;) {
    const stat = await fs.lstat(cursor);
    assert(stat.isDirectory() && !stat.isSymbolicLink());
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

async function run() {
  assert.equal(process.platform, 'win32');
  assert(process.stdin.isTTY && process.stdout.isTTY, 'Requires an owned terminal');
  assert.equal(process.argv.length, 4);
  assert(exeArg && path.isAbsolute(exeArg) && output);
  const executable = path.resolve(exeArg);
  const asar = path.join(path.dirname(executable), 'resources', 'app.asar');
  assert.equal(
    path.basename(executable).toLowerCase(),
    'aegis - ai monitoring & threat detection.exe',
  );
  await Promise.all([regular(executable), regular(asar)]);
  await unlinkedDirectory(path.dirname(output));
  await fs.mkdir(output);
  madeOutput = true;
  const before = { executable: await digest(executable), asar: await digest(asar) };
  receipt.artifacts = before;
  stage = 'archive-source-match';
  receipt.checkedSourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  receipt.archiveSourceFiles = {};
  for (const name of ['claude-guard-launch.js', 'claude-guard-broker.js', 'cli.js', 'main.js']) {
    const relative = path.join('src', 'main', name);
    const archived = extractFile(asar, relative);
    const checkout = await fs.readFile(path.join(root, relative));
    const blob = execFileSync('git', ['show', 'HEAD:src/main/' + name], {
      cwd: root,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    const record = {
      archiveSha256: createHash('sha256').update(archived).digest('hex'),
      checkoutSha256: createHash('sha256').update(checkout).digest('hex'),
      gitBlobSha256: createHash('sha256').update(blob).digest('hex'),
      ...bindSourceToBlob(archived, checkout, blob),
    };
    receipt.archiveSourceFiles[name] = record;
  }
  receipt.archiveSourcesMatch = true;

  stage = 'compile-disposable-stub';
  const stub = path.join(output, 'claude.exe');
  const settings = path.join(output, 'settings.json');
  await fs.writeFile(settings, '{}\n', { flag: 'wx' });
  const systemRoot = process.env.SystemRoot;
  assert(systemRoot && path.isAbsolute(systemRoot));
  const compiler = path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const witness = path.join(output, 'guard-terminal-witness.exe');
  for (const [target, source] of [
    [stub, 'guard-terminal-stub.cs'],
    [witness, 'guard-terminal-witness.cs'],
  ])
    execFileSync(compiler, ['/nologo', '/out:' + target, path.join(__dirname, source)], {
      cwd: output,
      timeout: 30000,
      windowsHide: true,
      stdio: 'pipe',
    });
  receipt.stubSha256 = await digest(stub);
  receipt.witnessSha256 = await digest(witness);
  const settingsHash = await digest(settings);
  const selection = { token: TOKEN, executable: stub, settings, cwd: output };

  stage = 'fake-receiver';
  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', (chunk) => {
      text += chunk.toString('utf8');
      if (text.length > 1024) req.destroy();
    });
    req.on('end', () => {
      if (req.method !== 'POST') {
        res.writeHead(400);
        return res.end();
      }
      const operation =
        req.url === '/claim/' + SESSION
          ? 'claim'
          : req.url === '/start/' + SESSION
            ? 'start'
            : req.url === '/finish/' + SESSION
              ? 'finish'
              : null;
      if (!operation) {
        res.writeHead(404);
        return res.end();
      }
      if (operation === 'claim' && receipt.events.length === 0) {
        try {
          const value = JSON.parse(text);
          if (
            Object.keys(value).sort().join(',') !== 'code,nonce' ||
            !/^[0-9]{6}$/.test(value.code) ||
            !/^[a-f0-9]{32}$/.test(value.nonce)
          )
            throw Error();
          const proof = createHmac('sha256', KEY)
            .update(
              JSON.stringify([SESSION, value.code, value.nonce, TOKEN, stub, settings, output]),
            )
            .digest('hex');
          receipt.events.push('claim');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ...selection, proof }));
        } catch {
          res.writeHead(400);
          return res.end();
        }
      }
      if (
        req.headers.authorization !== 'Bearer ' + TOKEN ||
        text !== '{}' ||
        (operation === 'start' && receipt.events.join(',') !== 'claim') ||
        (operation === 'finish' && receipt.events.join(',') !== 'claim,start')
      ) {
        res.writeHead(403);
        return res.end();
      }
      receipt.events.push(operation);
      res.writeHead(204);
      res.end();
    });
  });
  server.requestTimeout = 3000;
  server.headersTimeout = 3000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let launcher;
  let shellResult = null;
  let observer = null;
  let witnessResult = null;
  let witnessDeadline = performance.now();
  let witnessFile = null;
  let gateOpened = false;
  try {
    stage = 'scripted-production-command';
    const port = server.address().port;
    let clipboard;
    let choice = 0;
    const reader = {
      close: async () => {},
      status: () => ({ admission: 'closed', exit: 'confirmed' }),
    };
    const receiver = {
      port,
      sessionId: SESSION,
      launchKey: KEY,
      snapshot: () => ({ status: 'waiting', available: true, entries: [] }),
      close: async () => {},
    };
    const window = { isDestroyed: () => false };
    launcher = createClaudeGuardLauncher({
      target: settings,
      executable,
      appPath: asar,
      getWindow: () => window,
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [choice++ ? output : stub] }),
        showMessageBox: async () => ({ response: 1 }),
      },
      clipboard: {
        writeText: (value) => {
          clipboard = value;
        },
      },
      startReceiver: async () => receiver,
      openRead: async () => reader,
      createAdmission: () => ({
        capture: async () => ({}),
        verify: async () => true,
        close: () => {},
      }),
    });
    assert.equal(await launcher.start(() => true), 'GUARD_READY');
    assert.equal(typeof clipboard, 'string');
    assert(!clipboard.includes(KEY));
    receipt.productionCommandFromSource = true;

    stage = 'packaged-powershell-terminal';
    const powershell = path.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const env = {
      SystemRoot: systemRoot,
      WINDIR: systemRoot,
      ComSpec: path.join(systemRoot, 'System32', 'cmd.exe'),
      PATH: path.join(systemRoot, 'System32'),
      TEMP: output,
      TMP: output,
      USERPROFILE: output,
      APPDATA: output,
      LOCALAPPDATA: output,
      PATHEXT: process.env.PATHEXT,
    };
    assert(env.PATHEXT, 'Windows executable extensions are unavailable');
    assert(!Object.hasOwn(env, 'ELECTRON_RUN_AS_NODE'));
    const gate = path.join(output, 'terminal-gate');
    const ready = path.join(output, 'observer-ready');
    witnessFile = path.join(output, 'process-witness.json');
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    const gatedCommand = `$deadline=[DateTime]::UtcNow.AddSeconds(15); while (-not (Test-Path -LiteralPath ${quote(gate)})) { if ([DateTime]::UtcNow -gt $deadline) { exit 2 }; Start-Sleep -Milliseconds 20 }; ${clipboard}; $deadline=[DateTime]::UtcNow.AddSeconds(70); while (-not (Test-Path -LiteralPath ${quote(witnessFile)}) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 20 }`;
    shellResult = new Promise((resolve) => {
      shell = spawn(powershell, ['-NoProfile', '-Command', gatedCommand], {
        cwd: output,
        env,
        stdio: 'inherit',
        windowsHide: false,
      });
      let spawnError = false;
      shell.once('error', () => {
        spawnError = true;
      });
      shell.once('close', (code, signal) => {
        shellClosed = true;
        resolve({ code, signal, spawnError });
      });
    });
    shellResult.catch(() => {});
    witnessDeadline = performance.now() + 90000;
    observer = spawn(witness, [String(shell.pid), powershell, executable, ready, witnessFile], {
      cwd: output,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    witnessResult = new Promise((resolve) => {
      let spawnError = false;
      observer.once('error', () => {
        spawnError = true;
      });
      observer.once('close', (code, signal) => resolve({ code, signal, spawnError }));
    });
    witnessResult.catch(() => {});
    let readySeen = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await fs.access(ready);
        readySeen = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!readySeen) throw Error('Process witness did not become ready');
    // A partially created gate may release the child even when the write fails.
    gateOpened = true;
    await fs.writeFile(gate, '', { flag: 'wx' });
    const settled = await waitBounded(
      Promise.all([shellResult, witnessResult]),
      Math.max(0, witnessDeadline - performance.now()),
    );
    if (!settled?.value) throw Error('Owned process outcome unavailable');
    receipt.shell = settled.value[0];
    receipt.witness = settled.value[1];
    receipt.process = JSON.parse(await fs.readFile(witnessFile, 'utf8'));
    assert.equal(receipt.witness.code, 0);
    assert.equal(receipt.shell.code, 0);
    assert.equal(receipt.process.identified, true);
    assert.equal(receipt.process.gone, true);
    assert.equal(receipt.process.forced, false);
    assert.equal(receipt.process.exitCode, 0);
    assert.deepEqual(receipt.events, ['claim', 'start', 'finish']);
    const marker = await fs.readFile(path.join(output, 'stub-result.txt'), 'utf8');
    const match = /^PASS ([0-9]+) ([0-9]+)\n$/.exec(marker);
    assert(match, 'Disposable stub did not validate its inputs');
    const stubPid = Number(match[1]);
    const brokerPid = Number(match[2]);
    assert(stubPid > 0 && brokerPid > 0 && stubPid !== brokerPid);
    assert.equal(brokerPid, receipt.process.pid, 'Stub parent differs from the held broker');
    receipt.stubExited = await processGone(stubPid);
    receipt.brokerExited = await processGone(brokerPid);
    assert(receipt.stubExited && receipt.brokerExited, 'Owned child cleanup unconfirmed');
    assert.equal(await digest(stub), receipt.stubSha256);
    assert.equal(await digest(witness), receipt.witnessSha256);
    assert.equal(await digest(settings), settingsHash);
    assert.deepEqual({ executable: await digest(executable), asar: await digest(asar) }, before);
  } finally {
    if (shellResult) {
      receipt.cleanup = await settleOwnedProcesses({
        shellResult,
        witnessResult,
        gateOpened,
        witnessDeadline,
        stopShell: () => shell?.kill(),
        stopWitness: () => observer?.kill(),
        isShellClosed: () => shellClosed,
        readWitness: async () => JSON.parse(await fs.readFile(witnessFile, 'utf8')),
      });
    }
    const launcherCleanup = launcher
      ? await waitBounded(
          Promise.resolve().then(() => launcher.close()),
          3000,
        )
      : { fulfilled: true };
    receipt.launcherCleanupConfirmed = launcherCleanup?.fulfilled === true;
    server.closeAllConnections();
    const serverCleanup = await waitBounded(
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
      3000,
    );
    receipt.receiverCleanupConfirmed = serverCleanup?.fulfilled === true;
  }
  if (
    !receipt.cleanup?.confirmed ||
    !receipt.launcherCleanupConfirmed ||
    !receipt.receiverCleanupConfirmed
  )
    throw Error('Owned cleanup unconfirmed');
  receipt.complete = true;
  await fs.writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log('PASS: packaged broker and disposable receiver; scripted admission.');
}

module.exports = { uniformCRLFCheckout, bindSourceToBlob, settleOwnedProcesses };
if (require.main === module)
  run().catch(async (error) => {
    receipt.complete = false;
    receipt.failureStage = stage;
    receipt.failure = String(error.message).slice(0, 300);
    receipt.shellClosed = shellClosed;
    if (madeOutput)
      await fs
        .writeFile(path.join(output, 'failure.json'), JSON.stringify(receipt, null, 2) + '\n', {
          flag: 'wx',
        })
        .catch(() => {});
    console.error(
      'Packaged terminal qualification failed at ' + stage + '; private output retained.',
    );
    if (receipt.cleanup && !receipt.cleanup.confirmed)
      console.error('Owned process cleanup is unconfirmed; inspect the retained receipt.');
    process.exitCode = 1;
  });
