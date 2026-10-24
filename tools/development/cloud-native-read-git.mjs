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
 * @since v0.20.1
 */
export function reconstructPortableGit({ bundle, output, context }) {
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
  assert(
    !fs.existsSync(repository) && !fs.existsSync(source),
    'portable-git-reconstruction-not-fresh',
  );
  fs.mkdirSync(output, { recursive: true });
  const template = path.join(output, 'empty-template');
  fs.mkdirSync(template);
  const env = portableGitEnvironment(bundle, path.join(output, 'portable-temp'));
  const executable = path.join(bundle, 'runtime/git/bin/git.exe');
  assert(regular(executable) && inside(bundle, executable), 'portable-git-executable-refused');
  assert(
    context.portableGit?.executableSha256 === hash(executable),
    'portable-git-executable-hash-mismatch',
  );
  let commands = 0;
  const git = (...args) => {
    commands++;
    try {
      return execFileSync(executable, args, {
        cwd: output,
        env,
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 16384,
        windowsHide: true,
      }).trim();
    } catch {
      throw new Error('portable-git-command-refused');
    }
  };
  const version = git('--version');
  assert(/^git version [A-Za-z0-9.+-]{1,100}$/.test(version), 'portable-git-version-refused');
  assert(version === context.portableGit.version, 'portable-git-version-mismatch');
  assert(
    path.resolve(git('--exec-path')).toLowerCase() ===
      path.resolve(env.GIT_EXEC_PATH).toLowerCase(),
    'portable-git-exec-path-fallback',
  );
  git(
    '-c',
    'init.defaultBranch=qualification',
    'init',
    '--bare',
    '--template=' + template,
    repository,
  );
  const objects = path.join(bundle, 'gitstore/objects');
  assert(!fs.existsSync(path.join(objects, 'info/alternates')), 'portable-git-alternates-refused');
  fs.cpSync(objects, path.join(repository, 'objects'), { recursive: true });
  const shallow = path.join(bundle, 'gitstore/shallow');
  if (fs.existsSync(shallow)) fs.copyFileSync(shallow, path.join(repository, 'shallow'));
  git('--git-dir=' + repository, 'config', 'core.autocrlf', context.coreAutoCrlf);
  git('--git-dir=' + repository, 'config', 'core.eol', context.coreEol);
  git('--git-dir=' + repository, 'update-ref', 'refs/heads/qualification', context.sourceSha);
  git(
    '--git-dir=' + repository,
    'worktree',
    'add',
    '--quiet',
    '--detach',
    source,
    context.sourceSha,
  );
  assert(
    git('-C', source, 'rev-parse', 'HEAD') === context.sourceSha,
    'portable-git-head-mismatch',
  );
  assert(
    git('-C', source, 'rev-parse', 'HEAD^{tree}') === context.sourceTree,
    'portable-git-tree-mismatch',
  );
  assert(
    git('-C', source, 'status', '--porcelain', '--untracked-files=normal') === '',
    'portable-git-worktree-dirty',
  );
  assert(
    git('-C', source, 'rev-parse', '--git-dir') !==
      git('-C', source, 'rev-parse', '--git-common-dir'),
    'portable-git-worktree-not-isolated',
  );
  const copiedDriver = path.join(bundle, 'runtime/cloud-native-read-git.mjs');
  const sourceDriver = path.join(source, 'tools/development/cloud-native-read-git.mjs');
  assert(
    fs.readFileSync(copiedDriver).equals(fs.readFileSync(sourceDriver)),
    'portable-git-driver-source-mismatch',
  );
  return {
    status: 'PASS',
    version,
    commands,
    sourceHead: context.sourceSha,
    sourceTree: context.sourceTree,
    clean: true,
    isolated: true,
    originalPathFallback: false,
    driverSourceMatched: true,
    shallow: fs.existsSync(shallow),
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
  let result = { status: 'FAIL', code: 'portable-git-refused' };
  try {
    assert(
      path.isAbsolute(values.receipt) && !fs.existsSync(values.receipt),
      'portable-git-receipt-path',
    );
    const context = JSON.parse(fs.readFileSync(path.join(values.bundle, 'context.json'), 'utf8'));
    result = reconstructPortableGit({ bundle: values.bundle, output: values.output, context });
  } catch {
    process.exitCode = 1;
  }
  fs.writeFileSync(values.receipt, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, code: result.code }));
}
