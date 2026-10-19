import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const report = 'X:/tmp/aegis-ten-hour-20261019/reports/05-windows-context-reader';
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const list = (root) =>
  fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = `${root}/${entry.name}`;
    assert.ok(!entry.isSymbolicLink(), 'freeze-refuses-reparse');
    return entry.isDirectory() ? list(file) : [file];
  });
const evidence = process.argv[2] === 'evidence';
const destination = `${report}/${evidence ? 'final-evidence' : 'final-source'}`;
assert.ok(!fs.existsSync(destination), 'immutable-freeze-already-exists');
const owned = [
  ...list('sidecar/session-context-reader'),
  'src/main/session-context-windows-assets.js',
  'src/main/session-context-windows-io.js',
  'src/main/session-context-windows-reader.js',
  'tests/main/session-context-windows-io.test.js',
  'docs/SESSION-CONTEXT-WINDOWS-IO.md',
];
const dependencies = [
  'sidecar/hook-config-target/Native.cs',
  'sidecar/hook-config-target/TargetPath.cs',
  'sidecar/hook-config-target/TargetLease.cs',
  'sidecar/hook-transaction/Wire.cs',
  'src/main/session-context-reader.js',
  'src/main/claude-hook-windows-io-wire.js',
  'src/main/session-context.js',
  'src/main/session-context-parser.js',
  'src/main/session-context-value.js',
  'tests/fixtures/session-context/claude.jsonl',
  'tests/fixtures/session-context/codex.jsonl',
  'tests/fixtures/session-context/gemini.jsonl',
  'tools/development/bounded-command.mjs',
  'package.json',
  'package-lock.json',
  'vitest.config.js',
  'eslint.config.mjs',
  'tsconfig.main.json',
  'tsconfig.base.json',
];
const files = evidence
  ? [
      ...list(`${report}/build`),
      ...list(`${report}/metadata-build`),
      ...list(`${report}/mutant-build`),
      ...list(`${report}/eof-mutant`),
      ...fs
        .readdirSync(report)
        .filter((name) =>
          /^(final-[a-z0-9-]+\.(json|log)|assets\.json|native-controls\.json|transport-controls\.json|mutant\.json|mutant-(build|observed)\.log)$/.test(
            name,
          ),
        )
        .map((name) => `${report}/${name}`),
    ]
  : [...owned, ...dependencies];
const rows = files.map((file) => {
  const relative = evidence ? path.relative(report, file) : file;
  const copy = path.join(destination, relative);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
  return {
    path: relative.replaceAll('\\', '/'),
    bytes: fs.statSync(file).size,
    sha256: digest(file),
  };
});
const external = [
  'X:/tmp/aegis-w1-pipe-20261019/runtime/node.exe',
  'C:/Program Files/dotnet/dotnet.exe',
  'C:/Program Files/dotnet/sdk/10.0.302/dotnet.dll',
].map((file) => ({ path: file, sha256: digest(file) }));
const manifest = {
  kind: evidence ? 'final-evidence' : 'final-source',
  createdAt: new Date().toISOString(),
  base: '5973180e10177e84a5d02b23b78be6aa10085eb1',
  files: rows,
  external,
  launchAllowed: false,
};
if (evidence) manifest.sourceManifestSha256 = digest(`${report}/final-source/manifest.json`);
fs.writeFileSync(`${destination}/manifest.json`, JSON.stringify(manifest, null, 2), { flag: 'wx' });
console.log(
  JSON.stringify({
    kind: manifest.kind,
    files: rows.length,
    manifestSha256: digest(`${destination}/manifest.json`),
  }),
);
