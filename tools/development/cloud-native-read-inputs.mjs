import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  discoverGitLayout,
  copyPortableGit,
  reconstructPortableGit,
} from './cloud-native-read-git.mjs';

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    build: { type: 'string' },
    output: { type: 'string' },
  },
});
assert(process.platform === 'win32' && process.arch === 'x64');
assert(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted');
for (const value of Object.values(values)) assert(path.isAbsolute(value));
const source = path.resolve(values.source),
  build = path.resolve(values.build),
  out = path.resolve(values.output);
assert(!fs.existsSync(out), 'Fresh bundle staging directory required');
const git = (...args) =>
  execFileSync('git', args, { cwd: source, encoding: 'utf8', timeout: 20000 }).trim();
assert.equal(git('rev-parse', 'HEAD'), process.env.GITHUB_SHA);
assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
const config = (key) => {
  try {
    return git('config', '--get', key);
  } catch {
    return '';
  }
};
const context = {
  schema: 'aegis-cloud-native-inputs/1',
  sourceSha: process.env.GITHUB_SHA,
  sourceTree: git('rev-parse', 'HEAD^{tree}'),
  runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
  coreAutoCrlf: config('core.autocrlf') || 'false',
  coreEol: config('core.eol') || 'native',
  nodeVersion: process.versions.node,
  dependencyPackages: 0,
};
assert(
  !fs.existsSync(path.join(common, 'objects/info/alternates')),
  'External Git object stores refused',
);
let count = 0,
  bytes = 0;
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function copy(from, to) {
  const stat = fs.lstatSync(from);
  assert(!stat.isSymbolicLink(), 'Linked bundle inputs refused');
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) copy(path.join(from, entry), path.join(to, entry));
    return;
  }
  assert(stat.isFile() && stat.size <= 300 * 1024 ** 2, 'Input file budget');
  count++;
  bytes += stat.size;
  assert(count <= 30000 && bytes <= 1800 * 1024 ** 2, 'Bundle input budget');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
fs.mkdirSync(out);
copy(path.join(common, 'objects'), path.join(out, 'gitstore/objects'));
if (fs.existsSync(path.join(common, 'shallow')))
  copy(path.join(common, 'shallow'), path.join(out, 'gitstore/shallow'));
const transportFile = path.join(path.dirname(out), 'evidence/portable-git.json');
const transport = {
  schema: 1,
  status: 'FAIL',
  stage: 'discover-host-layout',
  hostVersion: git('--version'),
};
assert(!fs.existsSync(transportFile), 'Portable Git receipt must be fresh');
try {
  const gitExe = execFileSync(
    path.join(process.env.SystemRoot, 'System32/where.exe'),
    ['git.exe'],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 16384 },
  )
    .trim()
    .split(/\r?\n/)[0];
  const observedExecPath = git('--exec-path');
  transport.execPathTail = observedExecPath.split(/[\\/]/).slice(-3).join('/');
  const layout = discoverGitLayout(gitExe, observedExecPath);
  transport.nativeVersion = execFileSync(layout.native, ['--version'], {
    cwd: source,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 16384,
    windowsHide: true,
  }).trim();
  assert(
    transport.nativeVersion === transport.hostVersion,
    'Observed native Git version differs from selected host Git',
  );
  transport.stage = 'copy-native-git-and-dlls';
  transport.layout = copyPortableGit(layout, path.join(out, 'runtime/git'), copy);
  context.portableGit = {
    version: transport.nativeVersion,
    executableSha256: transport.layout.files.find((file) => file.name === 'bin/git.exe').sha256,
  };
  copy(
    path.join(source, 'tools/development/cloud-native-read-git.mjs'),
    path.join(out, 'runtime/cloud-native-read-git.mjs'),
  );
  transport.stage = 'sterile-path-current-source-reconstruction';
  transport.preflight = reconstructPortableGit({
    bundle: out,
    output: path.join(path.dirname(out), 'git-preflight'),
    context,
  });
  transport.status = 'PASS';
  transport.stage = 'completed';
} finally {
  const receipt = JSON.stringify(transport, null, 2) + '\n';
  assert(Buffer.byteLength(receipt) <= 262144, 'Portable Git receipt budget');
  fs.writeFileSync(transportFile, receipt, { flag: 'wx' });
}
copy(path.join(build, 'package/win-unpacked'), path.join(out, 'candidate'));
copy(path.join(build, 'etw-builder.json'), path.join(out, 'etw-builder.json'));
copy(path.join(build, 'evidence/reboot-build.json'), path.join(out, 'reboot-build.json'));
copy(process.execPath, path.join(out, 'runtime/node.exe'));
copy(
  path.join(source, 'scripts/qualification/windows-native-read-guest.ps1'),
  path.join(out, 'guest.ps1'),
);
const seen = new Set();
function packageRoot(request, owner) {
  const require = createRequire(path.join(owner, 'package.json'));
  let entry;
  try {
    entry = require.resolve(request + '/package.json');
  } catch {
    entry = require.resolve(request);
  }
  for (
    let folder = path.dirname(entry);
    folder !== path.dirname(folder);
    folder = path.dirname(folder)
  ) {
    const file = path.join(folder, 'package.json');
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).name === request)
      return folder;
  }
  throw new Error('Package root unavailable');
}
function dependency(name, owner, optional = false) {
  let folder;
  try {
    folder = packageRoot(name, owner);
  } catch (error) {
    if (optional) return;
    throw error;
  }
  if (seen.has(folder)) return;
  const relative = path.relative(source, folder);
  assert(
    relative.startsWith('node_modules' + path.sep) && !relative.includes('..'),
    'Dependency escaped locked source',
  );
  seen.add(folder);
  copy(folder, path.join(out, 'dependencies', relative));
  const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
  for (const child of Object.keys(metadata.dependencies ?? {})) dependency(child, folder);
  for (const child of Object.keys(metadata.optionalDependencies ?? {}))
    dependency(child, folder, true);
}
for (const name of ['playwright', 'playwright-core', '@electron/asar']) dependency(name, source);
context.dependencyPackages = seen.size;
fs.writeFileSync(path.join(out, 'context.json'), JSON.stringify(context, null, 2) + '\n', {
  flag: 'wx',
});
const files = [];
function inventory(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    assert(!entry.isSymbolicLink());
    if (entry.isDirectory()) inventory(file);
    else
      files.push({
        path: path.relative(out, file),
        bytes: fs.statSync(file).size,
        sha256: sha256(file),
      });
  }
}
inventory(out);
fs.writeFileSync(path.join(out, 'input-manifest.json'), JSON.stringify(files) + '\n', {
  flag: 'wx',
});
console.log(
  JSON.stringify({
    files: files.length,
    bytes,
    dependencyPackages: seen.size,
    sourceSha: context.sourceSha,
  }),
);
