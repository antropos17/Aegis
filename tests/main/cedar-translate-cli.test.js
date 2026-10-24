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
const { prepareExecution } = require('../../src/main/execution-policy');
const { translateSchema2Policy } = require('../../src/main/cedar-translator');
const runtime = require('../../src/main/cedar-runtime');
const script = fileURLToPath(new URL('../../scripts/translate-execution-policy.cjs', import.meta.url));
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
let root;
let input;
let guard;
let marker;
let action;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cedar-export-'));
  input = path.join(root, 'selected-private.json');
  marker = path.join(root, 'EXECUTION-MARKER');
  guard = path.join(root, 'no-evaluation.cjs');
  action = { executable: process.execPath, cwd: root, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'EXECUTED')`, 'PRIVATE_CANARY_ARGUMENT'], env: { PRIVATE_VALUE: 'PRIVATE_CANARY_ENV' } };
  fs.writeFileSync(guard, `const Module=require('node:module'); const cp=require('node:child_process'); for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=()=>{throw Error('CHILD_PROCESS_FORBIDDEN')}; const load=Module._load; Module._load=function(name){ if(String(name).includes('cedar-runtime')||String(name).includes('cedar-wasm'))throw Error('EVALUATION_FORBIDDEN'); const value=load.apply(this,arguments); if(value&&typeof value==='object'&&typeof value.evaluateExecutionPolicy==='function')return {...value,evaluateExecutionPolicy(){throw Error('EVALUATION_FORBIDDEN')},prepareExecution(){throw Error('EVALUATION_FORBIDDEN')}}; return value; };`);
});
afterEach(() => {
  runtime._resetForTest();
  for (const name of fs.readdirSync(root)) {
    const filename = path.join(root, name);
    const stat = fs.lstatSync(filename);
    if (stat.isDirectory() && !stat.isSymbolicLink()) throw Error('unexpected-fixture-directory');
    try { fs.unlinkSync(filename); } catch (error) { if (stat.isSymbolicLink() && process.platform === 'win32') fs.rmdirSync(filename); else throw error; }
  }
  fs.rmdirSync(root);
});
function original(version = 2, defaultDecision = 'deny') {
  const actions = ['allow', 'ask', 'deny'].map((label) => ({ ...action, args: [...action.args, label] }));
  return { schemaVersion: version, defaultDecision, rules: actions.map((selected, index) => ({ action: selected, decision: ['allow', 'ask', 'deny'][index] })), ...(version === 3 ? { reviewRequired: [actions[0]] } : {}) };
}
function run(args) {
  const child = spawnSync(process.execPath, ['--require', guard, script, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 32 * 1024, windowsHide: true, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=128', NODE_V8_COVERAGE: '' } });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, '');
  assert.equal((child.stdout.match(/\n/g) || []).length, 1);
  for (const secret of [root, 'PRIVATE_CANARY_ARGUMENT', 'PRIVATE_CANARY_ENV', 'PRIVATE_MALFORMED']) assert.equal((child.stdout + child.stderr).includes(secret), false);
  const status = JSON.parse(child.stdout);
  assert.equal(status.evaluated, false);
  assert.equal(status.activated, false);
  return { code: child.status, status };
}
const metadata = ({ decision, reason }) => ({ decision, reason });

describe('developer-only Cedar export CLI', () => {
  it('exports deterministic artifacts for both schemas without evaluation, activation or execution', async () => {
    for (const version of [2, 3])
      for (const fallback of ['ask', 'deny']) {
        const policy = original(version, fallback);
        const source = Buffer.from(JSON.stringify(policy));
        fs.writeFileSync(input, source);
        const output = path.join(root, `export-${version}-${fallback}.json`);
        const result = run([input, output]);
        assert.equal(result.code, 0);
        assert.equal(result.status.status, 'exported');
        const bytes = fs.readFileSync(output);
        assert.equal(bytes.at(-1), 10);
        assert.equal(result.status.bytes, bytes.length);
        assert.equal(result.status.sha256, digest(bytes));
        assert.equal(JSON.parse(bytes).schemaVersion, 4);
        assert.deepEqual(fs.readFileSync(input), source);
        const second = path.join(root, `repeat-${version}-${fallback}.json`);
        assert.equal(run([input, second]).code, 0);
        assert.deepEqual(fs.readFileSync(second), bytes);
        for (const selected of [...policy.rules.map((rule) => rule.action), { ...action, args: ['UNMATCHED'] }])
          for (const review of [true, false, 'true', 1]) {
            const request = path.join(root, 'request.json');
            fs.writeFileSync(request, JSON.stringify({ schemaVersion: 1, action: selected }));
            const old = await prepareExecution(input, request, { review });
            const cedar = await prepareExecution(output, request, { review });
            const matched = policy.rules.find((rule) => rule.action.args.at(-1) === selected.args.at(-1));
            const expected = version === 3 && matched?.decision === 'allow' ? { decision: 'ask', reason: 'review-required' } : { decision: matched?.decision || fallback, reason: `policy-${matched?.decision || fallback}` };
            assert.deepEqual(metadata(old), expected);
            assert.deepEqual(metadata(cedar), expected);
            assert.deepEqual(cedar.launch, old.launch);
            assert.equal(Boolean(cedar.launch), expected.decision === 'allow' || (review === true && expected.decision === 'ask'));
            if (cedar.launch) {
              assert.equal(Object.getPrototypeOf(cedar.launch.env), null);
              assert.equal(cedar.launch.env.NODE_V8_COVERAGE, '');
            }
          }
        assert.equal(fs.existsSync(marker), false);
        assert.deepEqual(fs.readFileSync(input), source);
      }
  }, 20000);

  it('preserves existing and source-as-destination files byte-for-byte', () => {
    const bytes = Buffer.from(JSON.stringify(original()));
    fs.writeFileSync(input, bytes);
    const existing = path.join(root, 'existing.json');
    const retained = Buffer.from('FOREIGN_PRIVATE_DESTINATION');
    fs.writeFileSync(existing, retained);
    for (const output of [existing, input]) {
      const result = run([input, output]);
      assert.equal(result.code, 2);
      assert.equal(result.status.status, 'refused');
      assert.equal(result.status.reason, 'destination-unavailable');
    }
    assert.deepEqual(fs.readFileSync(input), bytes);
    assert.deepEqual(fs.readFileSync(existing), retained);
  });

  it('keeps existing destination links and their targets unchanged', ({ skip }) => {
    fs.writeFileSync(input, JSON.stringify(original()));
    const target = path.join(root, 'foreign-target.json');
    const link = path.join(root, 'linked-output.json');
    const bytes = Buffer.from('FOREIGN_PRIVATE_TARGET');
    fs.writeFileSync(target, bytes);
    try { fs.symlinkSync(target, link, 'file'); } catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) skip('file symlink unavailable'); else throw error; }
    assert.equal(run([input, link]).code, 2);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.deepEqual(fs.readFileSync(target), bytes);
  });

  it('preserves hardlink aliases of the source', ({ skip }) => {
    const bytes = Buffer.from(JSON.stringify(original()));
    fs.writeFileSync(input, bytes);
    const hardlink = path.join(root, 'source-alias.json');
    try { fs.linkSync(input, hardlink); } catch (error) { if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) skip('hardlink unavailable'); else throw error; }
    assert.equal(run([input, hardlink]).status.reason, 'destination-unavailable');
    assert.deepEqual(fs.readFileSync(hardlink), bytes);
    assert.deepEqual(fs.readFileSync(input), bytes);
  });

  it('refuses directories and missing output parents', () => {
    fs.writeFileSync(input, JSON.stringify(original()));
    assert.equal(run([input, root]).status.reason, 'destination-unavailable');
    assert.equal(run([root, path.join(root, 'directory-input.json')]).status.reason, 'input-unavailable');
    const missingParent = path.join(root, 'missing-parent');
    assert.equal(run([input, path.join(missingParent, 'out.json')]).status.reason, 'destination-unavailable');
    assert.equal(fs.existsSync(missingParent), false);
  });

  it('preserves dangling destination links and refuses dangling selected inputs', ({ skip }) => {
    const bytes = Buffer.from(JSON.stringify(original()));
    fs.writeFileSync(input, bytes);
    const missingTarget = path.join(root, 'missing-target.json');
    const dangling = path.join(root, 'dangling.json');
    try { fs.symlinkSync(missingTarget, dangling, 'file'); } catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) skip('symlink unavailable'); else throw error; }
    assert.equal(run([input, dangling]).status.reason, 'destination-unavailable');
    assert.equal(run([dangling, path.join(root, 'dangling-input.json')]).status.reason, 'input-unavailable');
    assert.equal(fs.lstatSync(dangling).isSymbolicLink(), true);
    assert.equal(fs.existsSync(missingTarget), false);
    assert.deepEqual(fs.readFileSync(input), bytes);
  });

  it('refuses malformed, unsupported, missing and oversized selected inputs without creating output', () => {
    const output = path.join(root, 'refused.json');
    const valid = Buffer.from(JSON.stringify(original()));
    const oversized = Buffer.concat([valid, Buffer.alloc(65537 - valid.length, 32)]);
    const cases = [
      [Buffer.from('{PRIVATE_MALFORMED'), 'policy-invalid'],
      [Buffer.from([0xff]), 'policy-invalid'],
      [Buffer.from(JSON.stringify({ ...original(), schemaVersion: 1 })), 'policy-invalid'],
      [Buffer.from(JSON.stringify(translateSchema2Policy(original()).policy)), 'policy-invalid'],
      [Buffer.from(JSON.stringify({ ...original(), unknown: 'PRIVATE_CANARY_ENV' })), 'policy-invalid'],
      [Buffer.from(JSON.stringify({ ...original(), reviewRequired: [] })), 'policy-invalid'],
      [Buffer.from(JSON.stringify({ ...original(), rules: [original().rules[0], original().rules[0]] })), 'policy-invalid'],
      [Buffer.from(JSON.stringify({ ...original(), rules: [{ ...original().rules[0], action: { ...action, args: ['\ud800'] } }] })), 'policy-invalid'],
      [oversized, 'input-unavailable'],
    ];
    for (const [bytes, reason] of cases) {
      fs.writeFileSync(input, bytes);
      const result = run([input, output]);
      assert.equal(result.code, 2);
      assert.equal(result.status.status, 'refused');
      assert.equal(result.status.reason, reason);
      assert.equal(fs.existsSync(output), false);
    }
    fs.unlinkSync(input);
    assert.equal(run([input, output]).status.reason, 'input-unavailable');
  });

  it('refuses selected input links and does not modify their targets', ({ skip }) => {
    const target = path.join(root, 'target.json');
    const link = path.join(root, 'linked-source.json');
    const bytes = Buffer.from(JSON.stringify(original()));
    fs.writeFileSync(target, bytes);
    try { fs.symlinkSync(target, link, 'file'); } catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) skip('file symlink unavailable'); else throw error; }
    const output = path.join(root, 'refused.json');
    assert.equal(run([link, output]).status.reason, 'input-unavailable');
    assert.equal(fs.existsSync(output), false);
    assert.deepEqual(fs.readFileSync(target), bytes);
  });

  it('requires exactly two nonempty explicit paths and refuses special output names', () => {
    fs.writeFileSync(input, JSON.stringify(original()));
    const output = path.join(root, 'unused.json');
    for (const args of [[], [input], [input, output, 'EXTRA'], ['', output]]) assert.equal(run(args).status.reason, 'arguments-invalid');
    for (const name of ['NUL.json', 'COM¹.json', 'CONOUT$.json', 'data:stream', 'bad\nname.json', 'trailing.']) assert.equal(run([input, path.join(root, name)]).status.reason, 'destination-unavailable');
    assert.equal(run([input, '\\\\server\\private\\out.json']).status.reason, 'destination-unavailable');
    assert.equal(fs.existsSync(output), false);
  });

  it('counts the newline at the exact selected-file output boundary before creation', () => {
    function sized(target, character) {
      const unit = Buffer.byteLength(character);
      for (const fallback of ['deny', 'ask'])
        for (let padding = 0; padding < unit; padding++) {
          const suffix = 'x'.repeat(padding);
          const candidate = { schemaVersion: 2, defaultDecision: fallback, rules: [{ action: { ...action, args: [suffix] }, decision: 'allow' }] };
          const base = Buffer.byteLength(JSON.stringify(translateSchema2Policy(candidate).policy) + '\n');
          if ((target - base) % (2 * unit)) continue;
          candidate.rules[0].action.args = [character.repeat((target - base) / (2 * unit)) + suffix];
          assert.equal(Buffer.byteLength(JSON.stringify(translateSchema2Policy(candidate).policy) + '\n'), target);
          return candidate;
        }
      throw Error('boundary fixture unavailable');
    }
    for (const [index, character] of ['x', 'é', '🚀'].entries()) {
      const exact = path.join(root, `exact-${index}.json`);
      fs.writeFileSync(input, JSON.stringify(sized(65536, character)));
      const exported = run([input, exact]);
      assert.equal(exported.code, 0);
      assert.equal(exported.status.bytes, 65536);
      assert.equal(fs.statSync(exact).size, 65536);
      if (index) assert.ok(fs.readFileSync(exact, 'utf8').length < 65536);
      const over = path.join(root, `oversized-${index}.json`);
      fs.writeFileSync(input, JSON.stringify(sized(65537, character)));
      const result = run([input, over]);
      assert.equal(result.status.reason, 'output-too-large');
      assert.equal(result.code, 2);
      assert.equal(fs.existsSync(over), false);
    }
  });
});
