import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOTSTRAP_MODES, summarizeBootstrapReport } from './bootstrap-report.mjs';
import { runBootstrapProcess } from './bootstrap-process.mjs';
import { createVmVerifier } from './vm-wire.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const sources = [
  ...[
    'Native',
    'AppContainerProfile',
    'AppContainerWorkspace',
    'AppContainerWorkspaceInventory',
    'AppContainerInput',
    'AppContainerExecutable',
  ].map((name) => `sidecar/mcpjob/${name}.cs`),
  ...['BootstrapWire', 'BootstrapObservation', 'HvEndpoint', 'NativeBootstrapFixture'].map(
    (name) => `tests/fixtures/native-bootstrap/${name}.cs`,
  ),
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha256 = (filename) => digest(fs.readFileSync(filename));
const requireFixture = (value) => {
  if (!value) throw new Error('native-bootstrap-invalid');
};

function ephemeralInput(key, binding) {
  const payload = Buffer.from(JSON.stringify({ key: key.toString('base64'), ...binding }));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  const frame = Buffer.concat([header, payload]);
  payload.fill(0);
  return frame;
}

async function collectCase(executable, mode, options, executableHash) {
  const key = randomBytes(32);
  const binding = {
    sessionId: randomBytes(16).toString('hex'),
    vmId: randomUUID(), // Synthetic binding only; never an actual VM selector.
    epoch: randomBytes(16).toString('hex'),
    challenge: randomBytes(32).toString('hex'),
  };
  let verifier;
  try {
    const output = await runBootstrapProcess(
      executable,
      mode,
      ephemeralInput(key, binding),
      options,
    );
    const summary = summarizeBootstrapReport(output);
    const proof = JSON.parse(output);
    requireFixture(proof.mode === mode && proof.imageSha256 === executableHash);
    let frameVerified = false;
    if (proof.initialized) {
      verifier = createVmVerifier(key, {
        version: 1,
        sessionId: binding.sessionId,
        vmId: binding.vmId,
        epoch: binding.epoch,
        sequence: 1,
        challenge: binding.challenge,
        phase: 'initialized',
        imageSha256: proof.imageSha256,
        runtimeSha256: proof.runtimeSha256,
        principalSha256: proof.principalSha256,
        jobSha256: proof.jobSha256,
      });
      const frame = Buffer.from(proof.frameBase64, 'base64');
      try {
        verifier.accept(frame);
        let replayRefused = false;
        try {
          verifier.accept(frame);
        } catch {
          replayRefused = true;
        }
        requireFixture(replayRefused);
        frameVerified = true;
      } finally {
        frame.fill(0);
      }
    }
    // Persist no HMAC key, challenge, binding or raw authenticated frame.
    const redactedProof = { ...proof };
    delete redactedProof.frameBase64;
    return { proof: redactedProof, summary, nodeFrameVerified: frameVerified };
  } finally {
    verifier?.close();
    key.fill(0);
  }
}

function cleanScratch(scratch, parent, ownedFiles) {
  requireFixture(
    path.dirname(scratch) === parent &&
      !fs.lstatSync(scratch).isSymbolicLink() &&
      fs.realpathSync(scratch) === scratch,
  );
  for (const filename of ownedFiles) {
    requireFixture(path.dirname(filename) === scratch);
    if (!fs.existsSync(filename)) continue;
    const stat = fs.lstatSync(filename);
    requireFixture(stat.isFile() && !stat.isSymbolicLink());
    fs.unlinkSync(filename);
  }
  fs.rmdirSync(scratch); // Refuse unexpected/locked output, never recursive cleanup.
}

/**
 * Compile the fixed same-principal process fixture and run bounded native cases.
 * Reuses the unchanged existing atomic Job owner. Creates no VM or host setting.
 * @param {string[]} modes Fixed case names; default runs the complete matrix.
 * @returns {Promise<object>} Redacted provenance and non-authorizing observations.
 * @since v0.17.0
 */
export async function collectNativeBootstrap(modes = BOOTSTRAP_MODES) {
  requireFixture(
    Array.isArray(modes) &&
      modes.length > 0 &&
      modes.length <= BOOTSTRAP_MODES.length &&
      new Set(modes).size === modes.length &&
      modes.every((mode) => BOOTSTRAP_MODES.includes(mode)),
  );
  const selectedModes = [...modes];
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('native-bootstrap-windows-x64-required');
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const compiler = path.join(systemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const parent = fs.realpathSync(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(parent, 'aegis-native-bootstrap-'));
  const executable = path.join(scratch, 'fixture.exe');
  const stagedSources = sources.map((_, index) => path.join(scratch, `${index}.cs`));
  const options = {
    cwd: scratch,
    env: { SystemRoot: systemRoot, TEMP: scratch, TMP: scratch },
  };
  let receipt, failure;
  try {
    const sourceHashes = {};
    for (let index = 0; index < sources.length; index++) {
      const bytes = fs.readFileSync(path.join(project, sources[index]));
      sourceHashes[sources[index]] = digest(bytes);
      fs.writeFileSync(stagedSources[index], bytes, { flag: 'wx' });
    }
    const compilerHash = sha256(compiler);
    execFileSync(
      compiler,
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/optimize+',
        '/warnaserror+',
        '/r:System.Web.Extensions.dll',
        '/main:NativeBootstrapFixture',
        `/out:${executable}`,
        ...stagedSources,
      ],
      {
        ...options,
        timeout: 30000,
        maxBuffer: 16384,
        windowsHide: true,
        stdio: 'pipe',
      },
    );
    const executableHash = sha256(executable);
    const cases = [];
    for (const mode of selectedModes)
      cases.push(await collectCase(executable, mode, options, executableHash));
    requireFixture(sha256(compiler) === compilerHash && sha256(executable) === executableHash);
    for (let index = 0; index < sources.length; index++)
      requireFixture(sha256(stagedSources[index]) === sourceHashes[sources[index]]);
    receipt = {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      osBuild: Number(os.release().split('.')[2]),
      sourceSha256: sourceHashes,
      compilerSha256: compilerHash,
      executableSha256: executableHash,
      cases,
      summary: {
        scope: 'native-bootstrap-process-fixture',
        caseCount: cases.length,
        samePrincipalFixture: true,
        runtimeSubsetOnly: true,
        completeJobMemberInventory: false,
        vmBindingSynthetic: true,
        vmEffectsRun: false,
        launchAllowed: false,
        nativeContainmentQualified: false,
      },
    };
  } catch (error) {
    failure = error;
  }
  try {
    cleanScratch(scratch, parent, [executable, ...stagedSources]);
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireFixture([4, 6].includes(process.argv.length) && process.argv[2] === '--receipt');
    const selected = process.argv[3];
    requireFixture(path.isAbsolute(selected) && path.extname(selected) === '.json');
    requireFixture(!fs.existsSync(selected));
    requireFixture(process.argv.length === 4 || process.argv[4] === '--mode');
    const receipt = await collectNativeBootstrap(
      process.argv.length === 6 ? [process.argv[5]] : BOOTSTRAP_MODES,
    );
    const file = fs.openSync(selected, 'wx', 0o600);
    try {
      fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
      fs.fsyncSync(file);
    } finally {
      fs.closeSync(file);
    }
    process.stdout.write(JSON.stringify(receipt.summary) + '\n');
  } catch {
    process.stderr.write('native-bootstrap-unavailable\n');
    process.exitCode = 2;
  }
}
