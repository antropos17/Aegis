import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const regular = (file) =>
  fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink();
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

const FAILURE_CODES = new Set([
  'portable-git-platform',
  'portable-git-cloud-context',
  'portable-git-input-path',
  'portable-git-source-context',
  'portable-git-line-ending-context',
  'portable-git-node-mismatch',
  'portable-git-reconstruction-not-fresh',
  'portable-git-system-root',
  'portable-git-executable-refused',
  'portable-git-executable-hash-mismatch',
  'portable-git-command-refused',
  'portable-git-version-refused',
  'portable-git-version-mismatch',
  'portable-git-exec-path-fallback',
  'portable-git-alternates-refused',
  'portable-git-head-mismatch',
  'portable-git-tree-mismatch',
  'portable-git-worktree-dirty',
  'portable-git-worktree-not-isolated',
  'portable-git-driver-source-mismatch',
  'portable-git-receipt-path',
]);
const STAGES = new Set([
  'cli-input',
  'context-read',
  'context-parse',
  'input-validation',
  'fresh-output',
  'create-output',
  'create-template',
  'portable-environment',
  'executable-validation',
  'executable-hash',
  'version',
  'exec-path',
  'init-bare',
  'objects-validation',
  'objects-copy',
  'shallow-copy',
  'config-autocrlf',
  'config-eol',
  'update-ref',
  'worktree-add',
  'head',
  'tree',
  'status',
  'git-dir',
  'common-dir',
  'worktree-isolation',
  'copied-driver-read',
  'source-driver-read',
  'driver-byte-binding',
  'shallow-observation',
  'receipt-write',
]);
const COMMANDS = new Set([
  'version',
  'exec-path',
  'init-bare',
  'config-autocrlf',
  'config-eol',
  'update-ref',
  'worktree-add',
  'head',
  'tree',
  'status',
  'git-dir',
  'common-dir',
]);
const ERROR_CODES = new Set([
  'ERR_ASSERTION',
  'ENOENT',
  'EEXIST',
  'EACCES',
  'EPERM',
  'EINVAL',
  'EIO',
  'ENOSPC',
  'ENAMETOOLONG',
  'EROFS',
  'EMFILE',
  'ENFILE',
  'ETIMEDOUT',
  'ENOBUFS',
]);
const SIGNALS = new Set([
  'SIGTERM',
  'SIGKILL',
  'SIGINT',
  'SIGABRT',
  'SIGSEGV',
  'SIGILL',
  'SIGBREAK',
]);

/** Preserve only closed operation metadata; never publish error text or child streams.
 * @param {object} error Actual caught failure. @param {object} trace Fixed operation state.
 * @returns {object} Bounded diagnostic receipt. @since v0.20.1
 */
export function portableGitFailure(error, trace = {}) {
  return {
    status: 'FAIL',
    code: FAILURE_CODES.has(error?.message) ? error.message : 'portable-git-operation-refused',
    stage: STAGES.has(trace.stage) ? trace.stage : 'unknown',
    commandsAttempted:
      Number.isInteger(trace.commands) && trace.commands >= 0 && trace.commands <= 64
        ? trace.commands
        : 0,
    commandIndex:
      COMMANDS.has(trace.commandKind) &&
      Number.isInteger(trace.commands) &&
      trace.commands >= 1 &&
      trace.commands <= 64
        ? trace.commands
        : null,
    commandKind: COMMANDS.has(trace.commandKind) ? trace.commandKind : null,
    processStatus:
      Number.isInteger(error?.status) && error.status >= -2147483648 && error.status <= 4294967295
        ? error.status
        : null,
    signal: error?.signal == null ? null : SIGNALS.has(error.signal) ? error.signal : 'other',
    errorCode: error?.code == null ? null : ERROR_CODES.has(error.code) ? error.code : 'other',
    timedOut: error?.code === 'ETIMEDOUT',
  };
}

/** Execute the real copied Git call; the optional executor is a pure test seam.
 * @param {string} executable Copied native Git. @param {string[]} args Actual arguments.
 * @param {object} options Bounded process options. @param {object} trace Fixed operation state.
 * @param {Function} execute Native executor. @returns {string} Actual trimmed stdout.
 * @since v0.20.1
 */
export function portableGitCommand(executable, args, options, trace, execute = execFileSync) {
  trace.commands++;
  try {
    return execute(executable, args, options).trim();
  } catch (error) {
    const diagnostic = portableGitFailure(error, trace);
    diagnostic.code = 'portable-git-command-refused';
    const failure = new Error(diagnostic.code);
    failure.portableGitDiagnostic = diagnostic;
    throw failure;
  }
}

/** Resolve native Git and DLL locations from the observed executable/exec path.
 * The prefix name is discovered, so both legacy and UCRT layouts are supported.
 * @param {string} launcher Host command path. @param {string} execPath Actual git --exec-path.
 * @returns {object} Existing local runtime inputs. @since v0.20.1
 */
export function discoverGitLayout(launcher, execPath) {
  assert(path.isAbsolute(launcher) && path.isAbsolute(execPath), 'portable-git-layout-path');
  const prefix = path.dirname(path.dirname(execPath));
  const candidates = [path.join(prefix, 'bin/git.exe'), path.join(execPath, 'git.exe')];
  const native = candidates.find(regular);
  assert(
    native && fs.lstatSync(execPath).isDirectory() && !fs.lstatSync(execPath).isSymbolicLink(),
    'portable-git-layout-unavailable',
  );
  const dllDirectories = [
    ...new Set([path.dirname(native), path.join(prefix, 'bin'), execPath]),
  ].filter(
    (directory) =>
      fs.existsSync(directory) &&
      fs.lstatSync(directory).isDirectory() &&
      !fs.lstatSync(directory).isSymbolicLink(),
  );
  return { launcher, execPath, native, prefix, dllDirectories };
}

/** Copy only the native executable and co-located compiled DLL dependencies.
 * Git configuration, templates, hooks, scripts and credential data are excluded.
 * @param {object} layout Observed layout. @param {string} destination Fresh portable root.
 * @param {Function} copy Checked task-owned copy callback. @returns {object} Hash-only inventory.
 * @since v0.20.1
 */
export function copyPortableGit(layout, destination, copy) {
  assert(!fs.existsSync(destination), 'portable-git-output-not-fresh');
  const bin = path.join(destination, 'bin');
  const execPath = path.join(destination, 'libexec/git-core');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(execPath, { recursive: true });
  const selected = new Map([['git.exe', layout.native]]);
  for (const directory of layout.dllDirectories) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.name.toLowerCase().endsWith('.dll')) continue;
      const file = path.join(directory, entry.name);
      assert(
        entry.isFile() && !entry.isSymbolicLink() && regular(file),
        'portable-git-dll-refused',
      );
      const key = entry.name.toLowerCase();
      if (selected.has(key))
        assert(hash(selected.get(key)) === hash(file), 'portable-git-dll-collision');
      else selected.set(key, file);
    }
  }
  assert(selected.size > 1 && selected.size <= 256, 'portable-git-dependency-budget');
  const files = [];
  for (const [name, from] of selected) {
    const to = path.join(bin, name);
    copy(from, to);
    files.push({ name: 'bin/' + name, bytes: fs.statSync(to).size, sha256: hash(to) });
  }
  return {
    nativeName: path.basename(layout.native),
    prefixName: path.basename(layout.prefix),
    dllDirectories: layout.dllDirectories.map((directory) =>
      path.relative(layout.prefix, directory),
    ),
    files,
  };
}

/** Construct a process-local environment with no original Git PATH/config fallback.
 * @param {string} bundle Verified input root. @param {string} temporary Owned temp directory.
 * @returns {object} Isolated process environment. @since v0.20.1
 */
export function portableGitEnvironment(bundle, temporary) {
  fs.mkdirSync(temporary, { recursive: true });
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  assert(systemRoot && path.isAbsolute(systemRoot), 'portable-git-system-root');
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    PATH: [path.join(bundle, 'runtime/git/bin'), path.join(systemRoot, 'System32')].join(
      path.delimiter,
    ),
    TEMP: temporary,
    TMP: temporary,
    GIT_EXEC_PATH: path.join(bundle, 'runtime/git/libexec/git-core'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(temporary, 'absent-global-config'),
    GIT_CONFIG_COUNT: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

/** Reconstruct the actual commit with only copied Git, objects and shallow metadata.
 * Host preflight and guest preparation invoke this same implementation.
 * @param {object} options Bundle/output/context inputs. @returns {object} Observed command results.
 * @param {object} [dependencies] Closed trace and optional test-only executor.
 * @since v0.20.1
 */
export function reconstructPortableGit(options, dependencies = {}) {
  const trace = dependencies.trace ?? { stage: 'input-validation', commands: 0, commandKind: null };
  try {
    return reconstructPortableGitObserved(options, trace, dependencies.execute ?? execFileSync);
  } catch (error) {
    const diagnostic = error.portableGitDiagnostic ?? portableGitFailure(error, trace);
    const failure = new Error(diagnostic.code);
    failure.portableGitDiagnostic = diagnostic;
    throw failure;
  }
}

function reconstructPortableGitObserved({ bundle, output, context }, trace, execute) {
  const stage = (value) => {
    trace.stage = value;
    trace.commandKind = null;
  };
  stage('input-validation');
  assert(process.platform === 'win32' && process.arch === 'x64', 'portable-git-platform');
  assert(
    process.env.GITHUB_ACTIONS === 'true' &&
      ['github-hosted', 'github-hosted-hyperv-guest'].includes(process.env.RUNNER_ENVIRONMENT),
    'portable-git-cloud-context',
  );
  assert(path.isAbsolute(bundle) && path.isAbsolute(output), 'portable-git-input-path');
  assert(
    /^[a-f0-9]{40}$/.test(context.sourceSha) && /^[a-f0-9]{40}$/.test(context.sourceTree),
    'portable-git-source-context',
  );
  assert(
    ['true', 'false', 'input'].includes(context.coreAutoCrlf) &&
      ['native', 'lf', 'crlf'].includes(context.coreEol),
    'portable-git-line-ending-context',
  );
  assert(context.nodeVersion === process.versions.node, 'portable-git-node-mismatch');
  const repository = path.join(output, 'repository.git'),
    source = path.join(output, 'source');
  stage('fresh-output');
  assert(
    !fs.existsSync(repository) && !fs.existsSync(source),
    'portable-git-reconstruction-not-fresh',
  );
  stage('create-output');
  fs.mkdirSync(output, { recursive: true });
  const template = path.join(output, 'empty-template');
  stage('create-template');
  fs.mkdirSync(template);
  stage('portable-environment');
  const env = portableGitEnvironment(bundle, path.join(output, 'portable-temp'));
  const executable = path.join(bundle, 'runtime/git/bin/git.exe');
  stage('executable-validation');
  assert(regular(executable) && inside(bundle, executable), 'portable-git-executable-refused');
  stage('executable-hash');
  assert(
    context.portableGit?.executableSha256 === hash(executable),
    'portable-git-executable-hash-mismatch',
  );
  const git = (kind, ...args) => {
    stage(kind);
    trace.commandKind = kind;
    return portableGitCommand(
      executable,
      args,
      {
        cwd: output,
        env,
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 16384,
        windowsHide: true,
        stdio: 'pipe',
      },
      trace,
      execute,
    );
  };
  const version = git('version', '--version');
  assert(/^git version [A-Za-z0-9.+-]{1,100}$/.test(version), 'portable-git-version-refused');
  assert(version === context.portableGit.version, 'portable-git-version-mismatch');
  assert(
    path.resolve(git('exec-path', '--exec-path')).toLowerCase() ===
      path.resolve(env.GIT_EXEC_PATH).toLowerCase(),
    'portable-git-exec-path-fallback',
  );
  git(
    'init-bare',
    '-c',
    'init.defaultBranch=qualification',
    'init',
    '--bare',
    '--template=' + template,
    repository,
  );
  const objects = path.join(bundle, 'gitstore/objects');
  stage('objects-validation');
  assert(!fs.existsSync(path.join(objects, 'info/alternates')), 'portable-git-alternates-refused');
  stage('objects-copy');
  fs.cpSync(objects, path.join(repository, 'objects'), { recursive: true });
  const shallow = path.join(bundle, 'gitstore/shallow');
  stage('shallow-copy');
  if (fs.existsSync(shallow)) fs.copyFileSync(shallow, path.join(repository, 'shallow'));
  git(
    'config-autocrlf',
    '--git-dir=' + repository,
    'config',
    'core.autocrlf',
    context.coreAutoCrlf,
  );
  git('config-eol', '--git-dir=' + repository, 'config', 'core.eol', context.coreEol);
  git(
    'update-ref',
    '--git-dir=' + repository,
    'update-ref',
    'refs/heads/qualification',
    context.sourceSha,
  );
  git(
    'worktree-add',
    '--git-dir=' + repository,
    'worktree',
    'add',
    '--quiet',
    '--detach',
    source,
    context.sourceSha,
  );
  assert(
    git('head', '-C', source, 'rev-parse', 'HEAD') === context.sourceSha,
    'portable-git-head-mismatch',
  );
  assert(
    git('tree', '-C', source, 'rev-parse', 'HEAD^{tree}') === context.sourceTree,
    'portable-git-tree-mismatch',
  );
  assert(
    git('status', '-C', source, 'status', '--porcelain', '--untracked-files=normal') === '',
    'portable-git-worktree-dirty',
  );
  const gitDir = git('git-dir', '-C', source, 'rev-parse', '--git-dir');
  const commonDir = git('common-dir', '-C', source, 'rev-parse', '--git-common-dir');
  stage('worktree-isolation');
  assert(gitDir !== commonDir, 'portable-git-worktree-not-isolated');
  const copiedDriver = path.join(bundle, 'runtime/cloud-native-read-git.mjs');
  const sourceDriver = path.join(source, 'tools/development/cloud-native-read-git.mjs');
  stage('copied-driver-read');
  const copiedBytes = fs.readFileSync(copiedDriver);
  stage('source-driver-read');
  const sourceBytes = fs.readFileSync(sourceDriver);
  stage('driver-byte-binding');
  assert(copiedBytes.equals(sourceBytes), 'portable-git-driver-source-mismatch');
  stage('shallow-observation');
  const shallowPresent = fs.existsSync(shallow);
  return {
    status: 'PASS',
    version,
    commands: trace.commands,
    sourceHead: context.sourceSha,
    sourceTree: context.sourceTree,
    clean: true,
    isolated: true,
    originalPathFallback: false,
    driverSourceMatched: true,
    shallow: shallowPresent,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  const { values } = parseArgs({
    options: {
      bundle: { type: 'string' },
      output: { type: 'string' },
      receipt: { type: 'string' },
    },
  });
  const trace = { stage: 'cli-input', commands: 0, commandKind: null };
  let result;
  try {
    assert(
      path.isAbsolute(values.receipt) && !fs.existsSync(values.receipt),
      'portable-git-receipt-path',
    );
    trace.stage = 'context-read';
    const text = fs.readFileSync(path.join(values.bundle, 'context.json'), 'utf8');
    trace.stage = 'context-parse';
    const context = JSON.parse(text);
    result = reconstructPortableGit(
      { bundle: values.bundle, output: values.output, context },
      { trace },
    );
  } catch (error) {
    result = error.portableGitDiagnostic ?? portableGitFailure(error, trace);
    process.exitCode = 1;
  }
  try {
    fs.writeFileSync(values.receipt, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    trace.stage = 'receipt-write';
    trace.commandKind = null;
    result = portableGitFailure(error, trace);
    process.exitCode = 1;
  }
  console.log(JSON.stringify(result.status === 'FAIL' ? result : { status: result.status }));
}
