import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const script = fileURLToPath(new URL('../../scripts/translate-execution-policy.cjs', import.meta.url));
const sourceRoot = path.resolve(path.dirname(script), '..');
const { translateSchema2Policy } = require('../../src/main/cedar-translator');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
let root;
let input;
let source;
let policy;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cedar-cli-controls-'));
  input = path.join(root, 'input.json');
  source = fs.readFileSync(script);
  policy = { schemaVersion: 2, defaultDecision: 'deny', rules: [{ action: { executable: process.execPath, cwd: root, args: ['PRIVATE_CONTROL_ARGUMENT'], env: {} }, decision: 'allow' }] };
  fs.writeFileSync(input, JSON.stringify(policy));
});
afterEach(() => {
  assert.deepEqual(fs.readFileSync(script), source);
  for (const name of fs.readdirSync(root)) {
    const filename = path.join(root, name);
    const stat = fs.lstatSync(filename);
    if (stat.isDirectory() && !stat.isSymbolicLink()) throw Error('unexpected-fixture-directory');
    try { fs.unlinkSync(filename); } catch (error) { if (stat.isSymbolicLink() && process.platform === 'win32') fs.rmdirSync(filename); else throw error; }
  }
  fs.rmdirSync(root);
});
function copied(name, from, to) {
  let code = source.toString();
  if (from) {
    const matches = typeof from === 'string' ? code.split(from).length - 1 : [...code.matchAll(new RegExp(from.source, 'g'))].length;
    assert.equal(matches, 1);
    code = code.replace(from, to);
  }
  // Keep actual unchanged producer/reader dependencies without fixture links.
  for (const module of ['action-policy', 'cedar-translator']) {
    const original = `require('../src/main/${module}')`;
    assert.equal(code.split(original).length, 2);
    code = code.replace(original, `require(${JSON.stringify(path.join(sourceRoot, 'src/main', module))})`);
  }
  const filename = path.join(root, name + '.cjs');
  fs.writeFileSync(filename, code, { flag: 'wx' });
  return filename;
}
function processResult(filename, output) {
  const child = spawnSync(process.execPath, [filename, input, output], { encoding: 'utf8', timeout: 10000, maxBuffer: 32 * 1024, windowsHide: true, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=128', NODE_V8_COVERAGE: '' } });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, '');
  const result = JSON.parse(child.stdout);
  assert.equal(result.evaluated, false);
  assert.equal(result.activated, false);
  return { code: child.status, status: result.status, reason: result.reason, exists: fs.existsSync(output) };
}
function observe(id, mutant) {
  assert.deepEqual(fs.readFileSync(script), source);
  // eslint-disable-next-line no-console -- Record only public source hashes and observed control results.
  console.info(`Cedar CLI source-copy mutant=${id} original=${hash(source)} copy=${hash(fs.readFileSync(mutant))} contractRejected=true originalUnchanged=true`);
}
const uncertain = (result) => assert.deepEqual({ code: result.code, status: result.result.status, reason: result.result.reason }, { code: 3, status: 'unconfirmed-output', reason: 'output-unconfirmed' });

describe('CLI source-copy behavioral controls leave production source untouched', () => {
  it('executes an unmodified copy first and kills a weakened precreation byte limit', () => {
    const baseline = copied('baseline-size');
    const good = path.join(root, 'baseline-good.json');
    assert.equal(processResult(baseline, good).status, 'exported');
    assert.deepEqual(JSON.parse(fs.readFileSync(good)), translateSchema2Policy(policy).policy);
    for (const fallback of ['deny', 'ask']) {
      const candidate = { ...policy, defaultDecision: fallback, rules: [{ ...policy.rules[0], action: { ...policy.rules[0].action, args: [''] } }] };
      const length = Buffer.byteLength(JSON.stringify(translateSchema2Policy(candidate).policy) + '\n');
      if ((65537 - length) % 2) continue;
      candidate.rules[0].action.args = ['x'.repeat((65537 - length) / 2)];
      assert.equal(Buffer.byteLength(JSON.stringify(translateSchema2Policy(candidate).policy) + '\n'), 65537);
      fs.writeFileSync(input, JSON.stringify(candidate));
      break;
    }
    const contract = (result) => assert.deepEqual(result, { code: 2, status: 'refused', reason: 'output-too-large', exists: false });
    contract(processResult(baseline, path.join(root, 'baseline-refused.json')));
    const mutant = copied('mutant-size', 'if (output.length > LIMITS.bytes)', 'if (output.length > LIMITS.bytes + 1)');
    const output = path.join(root, 'mutant-size.json');
    const result = processResult(mutant, output);
    assert.equal(result.code, 3);
    assert.equal(result.reason, 'output-unconfirmed');
    assert.equal(fs.statSync(output).size, 65537);
    assert.throws(() => contract(result), { code: 'ERR_ASSERTION' });
    observe('byte-limit', mutant);
  });

  it('kills ignored close uncertainty using the actual writer and a real closed file', async () => {
    async function selected(filename, output) {
      const owner = require(filename);
      let closeCalls = 0;
      owner._setDepsForTest({ outputIO: { async open(...args) {
        const handle = await fs.promises.open(...args);
        return { stat: () => handle.stat(), write: (...writeArgs) => handle.write(...writeArgs), sync: () => handle.sync(), async close() { closeCalls++; await handle.close(); throw Error('PRIVATE_CLOSE_FAULT'); } };
      } } });
      try { const result = await owner.exportSelectedPolicy([input, output]); assert.equal(closeCalls, 1); return result; }
      finally { owner._resetForTest(); }
    }
    const baseline = copied('baseline-close');
    uncertain(await selected(baseline, path.join(root, 'baseline-close.json')));
    const from = / {4}await handle\.close\(\);\r?\n {4}handle = null;/;
    const to = '    try { await handle.close(); } catch (_) {}\n    handle = null;';
    const mutant = copied('mutant-close', from, to);
    const result = await selected(mutant, path.join(root, 'mutant-close.json'));
    assert.equal(result.code, 0);
    assert.equal(result.result.status, 'exported');
    assert.throws(() => uncertain(result), { code: 'ERR_ASSERTION' });
    observe('close-confirmation', mutant);
  });

  it('kills omitted created-identity binding while preserving a same-byte foreign replacement', async () => {
    async function selected(filename, label) {
      const owner = require(filename);
      const output = path.join(root, label + '.json');
      const retained = path.join(root, label + '-retained.json');
      let foreign;
      owner._setDepsForTest({ outputIO: { async open(...args) {
        const handle = await fs.promises.open(...args);
        return { stat: () => handle.stat(), write: (...writeArgs) => handle.write(...writeArgs), sync: () => handle.sync(), async close() {
          await handle.close(); foreign = fs.readFileSync(output); fs.renameSync(output, retained); fs.writeFileSync(output, foreign, { flag: 'wx', mode: 0o600 });
        } };
      } } });
      try {
        const result = await owner.exportSelectedPolicy([input, output]);
        assert.deepEqual(fs.readFileSync(output), foreign);
        assert.deepEqual(fs.readFileSync(retained), foreign);
        return result;
      } finally { owner._resetForTest(); }
    }
    const baseline = copied('baseline-identity');
    uncertain(await selected(baseline, 'baseline-identity'));
    const mutant = copied('mutant-identity', /!sameIdentity\(expected, stat\)\s*\|\|\s*/, '');
    const result = await selected(mutant, 'mutant-identity');
    assert.equal(result.code, 0);
    assert.equal(result.result.status, 'exported');
    assert.throws(() => uncertain(result), { code: 'ERR_ASSERTION' });
    observe('created-identity', mutant);
  });
});
