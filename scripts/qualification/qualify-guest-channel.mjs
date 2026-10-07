import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBootstrapProcess } from './bootstrap-process.mjs';
import { createVmVerifier } from './vm-wire.mjs';
import { requireVm } from './vm-contract.mjs';
import { createGuestChannel } from './guest-channel-wire.mjs';
import { GUEST_CHANNEL_MODES, summarizeGuestChannelReport } from './guest-channel-report.mjs';
import { cleanGuestFixedTask, observeGuestFixedTask } from './guest-channel-oracle.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const sources = [
  ...['GuestJobNative', 'GuestJobInventory'].map((name) => `sidecar/session/${name}.cs`),
  ...[
    'Native',
    'AppContainerProfile',
    'AppContainerWorkspace',
    'AppContainerWorkspaceInventory',
    'AppContainerInput',
    'AppContainerExecutable',
  ].map((name) => `sidecar/mcpjob/${name}.cs`),
  ...['BootstrapWire', 'BootstrapObservation'].map(
    (name) => `tests/fixtures/native-bootstrap/${name}.cs`,
  ),
  ...['GuestChannelWire', 'GuestFixedTask', 'GuestChannelFixture'].map(
    (name) => `tests/fixtures/guest-channel/${name}.cs`,
  ),
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha = (filename) => digest(fs.readFileSync(filename));
function framed(payload) {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}
function discoverTools(systemRoot, cwd) {
  const found = execFileSync(path.join(systemRoot, 'System32/where.exe'), ['git.exe'], {
    cwd,
    env: { SystemRoot: systemRoot, PATH: process.env.PATH },
    timeout: 5000,
    maxBuffer: 4096,
    windowsHide: true,
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/);
  const nodePath = fs.realpathSync(process.execPath);
  const gitPath = fs.realpathSync(found[0]);
  for (const selected of [nodePath, gitPath]) {
    const stat = fs.lstatSync(selected);
    requireVm(/^[a-z]:[/\\]/i.test(selected) && path.extname(selected).toLowerCase() === '.exe');
    requireVm(stat.isFile() && !stat.isSymbolicLink());
  }
  const gitVersion = execFileSync(gitPath, ['--version'], {
    cwd,
    env: { SystemRoot: systemRoot },
    timeout: 5000,
    maxBuffer: 4096,
    windowsHide: true,
    encoding: 'utf8',
  }).trim();
  requireVm(/^git version [0-9.]+(?:\.windows\.[0-9]+)?$/.test(gitVersion));
  return {
    tools: { nodePath, nodeSha256: sha(nodePath), gitPath, gitSha256: sha(gitPath) },
    gitVersion,
  };
}
async function collectCase(executable, mode, options, tools, executableHash, confirmed) {
  const key = randomBytes(32);
  const context = {
    sessionId: randomBytes(16).toString('hex'),
    vmId: randomUUID(),
    epoch: randomBytes(16).toString('hex'),
    challenge: randomBytes(32).toString('hex'),
  };
  let channel, initializedVerifier, input;
  try {
    channel = createGuestChannel({ key, context, role: 'host' });
    const command = channel.send(mode === 'cancel' ? 'cancel' : 'release');
    const bindingPayload = Buffer.from(JSON.stringify({ key: key.toString('base64'), ...context }));
    const bindingFrame = framed(bindingPayload);
    const toolsFrame = framed(Buffer.from(JSON.stringify(tools)));
    input = Buffer.concat([bindingFrame, toolsFrame, command]);
    bindingPayload.fill(0);
    bindingFrame.fill(0);
    command.fill(0);
    const output = await runBootstrapProcess(executable, mode, input, options);
    const summary = summarizeGuestChannelReport(output);
    const proof = JSON.parse(output);
    requireVm(proof.mode === mode && proof.imageSha256 === executableHash);
    requireVm(proof.nodeSha256 === tools.nodeSha256 && proof.gitSha256 === tools.gitSha256);
    // Cleanup permission here follows actual native accounting, not a wire stopped message.
    confirmed.add(mode);
    initializedVerifier = createVmVerifier(key, {
      version: 1,
      ...context,
      sequence: 1,
      phase: 'initialized',
      imageSha256: proof.imageSha256,
      runtimeSha256: proof.runtimeSha256,
      principalSha256: proof.principalSha256,
      jobSha256: proof.jobSha256,
    });
    const initialized = Buffer.from(proof.initializedFrameBase64, 'base64');
    try {
      initializedVerifier.accept(initialized);
    } finally {
      initialized.fill(0);
    }
    let resultData = null;
    if (proof.resultAccepted) {
      const frame = Buffer.from(proof.resultFrameBase64, 'base64');
      try {
        const result = channel.accept(frame);
        requireVm(result.operation === 'result');
        resultData = result.data;
      } finally {
        frame.fill(0);
      }
    }
    if (proof.stopMessageAccepted) {
      const frame = Buffer.from(proof.stoppedFrameBase64, 'base64');
      try {
        requireVm(channel.accept(frame).operation === 'stopped');
      } finally {
        frame.fill(0);
      }
      requireVm(
        channel.snapshot().state === 'closed' &&
          channel.snapshot().executionClosureConfirmed === false,
      );
    }
    const root = path.join(options.cwd, `project-${mode}`);
    const localOracle = observeGuestFixedTask(root, resultData, proof.taskObserved);
    if (resultData) resultData.fill(0);
    const redacted = { ...proof };
    for (const field of ['initializedFrameBase64', 'resultFrameBase64', 'stoppedFrameBase64'])
      delete redacted[field];
    return {
      proof: redacted,
      summary,
      localOracle,
      nodeInitializationVerified: true,
      nodeChannelVerified: proof.stopMessageAccepted,
    };
  } finally {
    input?.fill(0);
    channel?.close();
    initializedVerifier?.close();
    key.fill(0);
  }
}
function cleanup(scratch, parent, owned, confirmed) {
  requireVm(
    path.dirname(scratch) === parent &&
      fs.realpathSync(scratch) === scratch &&
      !fs.lstatSync(scratch).isSymbolicLink(),
  );
  for (const mode of confirmed) {
    const root = path.join(scratch, `project-${mode}`);
    requireVm(path.dirname(root) === scratch);
    if (fs.existsSync(root)) cleanGuestFixedTask(root);
  }
  for (const filename of owned) {
    requireVm(path.dirname(filename) === scratch);
    if (!fs.existsSync(filename)) continue;
    const stat = fs.lstatSync(filename);
    requireVm(stat.isFile() && !stat.isSymbolicLink());
    fs.unlinkSync(filename);
  }
  fs.rmdirSync(scratch); // Retain unexpected/unconfirmed workspaces; never recursively clear TEMP.
}

/**
 * Exercise a fixed trusted Node/Git task and bidirectional C#/JS channel inside
 * a same-principal Windows process Job. No VM or service is created or operated.
 * @param {string[]} modes Fixed test matrix, snapshotted before asynchronous work.
 * @returns {Promise<object>} Redacted actual local evidence; guest isolation unqualified.
 * @since v0.17.0
 */
export async function collectGuestChannel(modes = GUEST_CHANNEL_MODES) {
  requireVm(Array.isArray(modes) && modes.length > 0 && modes.length <= GUEST_CHANNEL_MODES.length);
  requireVm(
    new Set(modes).size === modes.length &&
      modes.every((mode) => GUEST_CHANNEL_MODES.includes(mode)),
  );
  const selected = [...modes];
  requireVm(process.platform === 'win32' && process.arch === 'x64');
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const compiler = path.join(systemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const parent = fs.realpathSync(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(parent, 'aegis-guest-channel-'));
  const executable = path.join(scratch, 'fixture.exe');
  const staged = sources.map((_, index) => path.join(scratch, `${index}.cs`));
  const options = { cwd: scratch, env: { SystemRoot: systemRoot, TEMP: scratch, TMP: scratch } };
  const confirmed = new Set();
  let receipt, failure;
  try {
    const { tools, gitVersion } = discoverTools(systemRoot, scratch);
    const sourceSha256 = {};
    for (let index = 0; index < sources.length; index++) {
      const bytes = fs.readFileSync(path.join(project, sources[index]));
      sourceSha256[sources[index]] = digest(bytes);
      fs.writeFileSync(staged[index], bytes, { flag: 'wx' });
    }
    const compilerSha256 = sha(compiler);
    execFileSync(
      compiler,
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/optimize+',
        '/warnaserror+',
        '/r:System.Web.Extensions.dll',
        '/main:GuestChannelFixture',
        `/out:${executable}`,
        ...staged,
      ],
      { ...options, timeout: 30000, maxBuffer: 16384, windowsHide: true, stdio: 'pipe' },
    );
    const executableSha256 = sha(executable);
    const cases = [];
    for (const mode of selected)
      cases.push(await collectCase(executable, mode, options, tools, executableSha256, confirmed));
    requireVm(sha(compiler) === compilerSha256 && sha(executable) === executableSha256);
    requireVm(sha(tools.nodePath) === tools.nodeSha256 && sha(tools.gitPath) === tools.gitSha256);
    for (let index = 0; index < staged.length; index++)
      requireVm(sha(staged[index]) === sourceSha256[sources[index]]);
    receipt = {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      osBuild: Number(os.release().split('.')[2]),
      nodeVersion: process.versions.node,
      gitVersion,
      sourceSha256,
      compilerSha256,
      executableSha256,
      nodeExecutableSha256: tools.nodeSha256,
      gitExecutableSha256: tools.gitSha256,
      cases,
      summary: {
        scope: 'guest-channel-process-fixture',
        caseCount: cases.length,
        transport: 'anonymous-pipe',
        samePrincipalFixture: true,
        runtimeSubsetOnly: true,
        completeJobMemberInventory: false,
        vmBindingSynthetic: true,
        vmEffectsRun: false,
        guestNodeGitQualified: false,
        launchAllowed: false,
        nativeContainmentQualified: false,
      },
    };
  } catch (error) {
    failure = error;
  }
  try {
    cleanup(scratch, parent, [executable, ...staged], confirmed);
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireVm([4, 6].includes(process.argv.length) && process.argv[2] === '--receipt');
    const selected = process.argv[3];
    requireVm(
      path.isAbsolute(selected) && path.extname(selected) === '.json' && !fs.existsSync(selected),
    );
    requireVm(process.argv.length === 4 || process.argv[4] === '--mode');
    const receipt = await collectGuestChannel(
      process.argv.length === 6 ? [process.argv[5]] : GUEST_CHANNEL_MODES,
    );
    const fd = fs.openSync(selected, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(receipt, null, 2) + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    process.stdout.write(JSON.stringify(receipt.summary) + '\n');
  } catch {
    process.stderr.write('guest-channel-unavailable\n');
    process.exitCode = 2;
  }
}
