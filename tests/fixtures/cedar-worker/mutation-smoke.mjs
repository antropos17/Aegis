import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

// Mutate only disposable source copies. Remove the exact owned directory on completion.
const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const require = createRequire(path.join(root, 'package.json'));
const tempRoot = path.resolve(os.tmpdir());
assert.equal(path.parse(tempRoot).root.toUpperCase(), 'X:\\');
const owned = await fs.mkdtemp(path.join(tempRoot, 'cedar-worker-mutants-'));
const evidenceRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (evidenceRoot) {
  assert.equal(path.parse(evidenceRoot).root.toUpperCase(), 'X:\\');
  await fs.mkdir(evidenceRoot, { recursive: true });
}
const sourceNames = [
  'cedar-worker-client',
  'cedar-worker-thread',
  'cedar-runtime',
  'cedar-schema',
  'execution-policy',
  'execution-binding',
  'action-policy',
];
const mutations = [
  {
    name: 'cached-worker-diagnostics',
    file: 'cedar-worker-client',
    from: "if (debuglog('worker').enabled) return Promise.resolve(deny('cedar-unavailable'));",
    to: '',
    test: 'worker diagnostics',
  },
  {
    name: 'proxy-data-admission',
    file: 'cedar-worker-thread',
    from: 'if (isProxy(value)) throw Error();',
    to: '',
    test: 'admitted proxy|proxy reply',
  },
];
const copy = async (from, to) => {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
};
try {
  await fs.writeFile(
    path.join(owned, 'package.json'),
    JSON.stringify({ name: 'cedar-worker-mutation-fixture', private: true }),
  );
  for (const name of sourceNames)
    await copy(
      path.join(root, 'src/main', name + '.js'),
      path.join(owned, 'src/main', name + '.js'),
    );
  for (const name of ['cedar-worker-client', 'cedar-worker-thread'])
    await copy(
      path.join(root, 'tests/main', name + '.test.js'),
      path.join(owned, 'tests/main', name + '.test.js'),
    );
  await copy(
    path.join(root, 'tests/fixtures/cedar-worker/adversary.cjs'),
    path.join(owned, 'tests/fixtures/cedar-worker/adversary.cjs'),
  );
  const cedarRoot = path.dirname(path.dirname(require.resolve('@cedar-policy/cedar-wasm/nodejs')));
  for (const name of [
    'package.json',
    'nodejs/package.json',
    'nodejs/cedar_wasm.js',
    'nodejs/cedar_wasm_bg.wasm',
  ])
    await copy(
      path.join(cedarRoot, name),
      path.join(owned, 'node_modules/@cedar-policy/cedar-wasm', name),
    );
  const config = path.join(owned, 'vitest.config.mjs');
  const vitestImport = path.join(
    path.dirname(require.resolve('vitest/package.json')),
    'dist/index.js',
  );
  await fs.writeFile(
    config,
    `export default ${JSON.stringify({ resolve: { alias: { vitest: vitestImport } }, test: { include: ['tests/main/*.test.js'], environment: 'node', maxWorkers: 1 } })};`,
  );
  const cli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const digest = (text) => createHash('sha256').update(text).digest('hex');
  const run = async (name, test) => {
    const args = [cli, 'run', '--root', owned, '--config', config, ...(test ? ['-t', test] : [])];
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const sourceHashes = {};
    for (const file of [
      'src/main/cedar-worker-client.js',
      'src/main/cedar-worker-thread.js',
      'tests/main/cedar-worker-client.test.js',
      'tests/main/cedar-worker-thread.test.js',
      'tests/fixtures/cedar-worker/adversary.cjs',
    ])
      sourceHashes[file] = digest(await fs.readFile(path.join(owned, file)));
    let code = 0;
    let output;
    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, args, {
        cwd: owned,
        env: { ...process.env },
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 512 * 1024,
      });
      output = stdout + stderr;
    } catch (error) {
      if (error.killed || !Number.isInteger(error.code)) throw error;
      code = error.code;
      output = error.stdout + error.stderr;
    }
    const receipt = {
      name,
      startedAt,
      completedAt: new Date().toISOString(),
      elapsedMs: performance.now() - started,
      node: process.version,
      executable: process.execPath,
      cwd: owned,
      args,
      code,
      sourceHashes,
      logBytes: Buffer.byteLength(output),
      logSha256: digest(output),
    };
    if (evidenceRoot) {
      await fs.writeFile(path.join(evidenceRoot, name + '.log'), output);
      await fs.writeFile(path.join(evidenceRoot, name + '.json'), JSON.stringify(receipt, null, 2));
    }
    return { code, output, receipt };
  };
  const baseline = await run(
    'pristine-regressions',
    'admitted proxy|proxy reply|worker diagnostics',
  );
  assert.equal(baseline.code, 0, baseline.output.slice(-4000));
  assert.match(baseline.output, /7 passed/);
  const receipts = [
    {
      name: 'pristine-regressions',
      code: baseline.code,
      passed: 7,
      logSha256: baseline.receipt.logSha256,
    },
  ];
  for (const mutation of mutations) {
    const filename = path.join(owned, 'src/main', mutation.file + '.js');
    const original = await fs.readFile(filename, 'utf8');
    assert.equal(original.split(mutation.from).length, 2, 'Mutation anchor must be unique');
    await fs.writeFile(filename, original.replace(mutation.from, mutation.to));
    try {
      const result = await run(mutation.name, mutation.test);
      assert.notEqual(result.code, 0, 'Survived mutant: ' + mutation.name);
      assert.match(result.output, /AssertionError/);
      assert.doesNotMatch(result.output, /Test timed out|Unhandled Error/);
      receipts.push({
        name: mutation.name,
        code: result.code,
        killed: true,
        assertion: result.output.match(/AssertionError[^\r\n]*/)?.[0],
        logSha256: result.receipt.logSha256,
      });
    } finally {
      await fs.writeFile(filename, original);
    }
  }
  console.log(
    JSON.stringify({
      scope: 'R2 two selected assertion mutants only; R1 mutants not rerun',
      receipts,
    }),
  );
} finally {
  const resolved = await fs.realpath(owned);
  assert.ok(resolved.startsWith(tempRoot + path.sep));
  assert.ok(path.basename(resolved).startsWith('cedar-worker-mutants-'));
  assert.equal((await fs.lstat(owned)).isSymbolicLink(), false);
  await fs.rm(resolved, { recursive: true });
}
