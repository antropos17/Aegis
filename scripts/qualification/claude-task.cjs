'use strict';

// Fixed standard-user guest phase. Native caller/Job admission belongs to its owner.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const p = require('./claude-protocol.cjs');
if (process.platform !== 'win32' || process.argv.length !== 2 || process.env.AEGIS_CLOUD_GUEST_CLAUDE !== '1' ||
    process.execPath.toLowerCase().replaceAll('\\', '/') !== `${p.TRUSTED}/node.exe`.toLowerCase()) process.exit(2);
const begin = performance.now(), cli = `${p.TRUSTED}/claude.exe`;
const expectedSha = 'eb95bb65955f8b1702e800815f9a2c0388a5de0f196c354c7ee1dd5cb9a2ba23';
const result = { schemaVersion: 1, task: 'fixed-claude-read-edit-test', passed: false, stage: 'prepare', failure: null,
  version: '2.1.292', cliSha256: null, cliExitCode: null, cliExitObserved: false, deadlineExpired: false,
  outputLimit: false, stdoutBytes: 0, stderrBytes: 0, clientResultValid: false, taskObservedReadEditTestPassed: false,
  taskObservedEditedBytesMatch: false, taskObservedTestExitCode: null, trustedTestProcessObservation: 'unknown',
  acceptancePassed: false, clientMilliseconds: null, elapsedMilliseconds: 0 };
let currentChild = null, monitor = null;
const codes = new Set(['prepare-refused', 'binary-refused', 'binary-changed', 'endpoint-refused', 'client-failed',
  'client-timeout', 'client-output-limit', 'scratch-limit', 'result-refused', 'edit-refused', 'test-refused', 'phase-deadline']);
function refuse(code) { throw new Error(code); }
function regular(selected) {
  const st = fs.lstatSync(selected);
  if (!st.isFile() || st.isSymbolicLink() || fs.realpathSync.native(selected).toLowerCase() !== path.resolve(selected).toLowerCase()) refuse('prepare-refused');
  return st;
}
function small(selected, limit) {
  const st = regular(selected), fd = fs.openSync(selected, 'r');
  try {
    const observed = fs.fstatSync(fd), bytes = Buffer.alloc(limit + 1);
    if (st.size > limit || observed.ino !== st.ino || observed.dev !== st.dev) refuse('prepare-refused');
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0), final = fs.fstatSync(fd);
    if (count !== st.size || count > limit || final.ctimeMs !== observed.ctimeMs || final.mtimeMs !== observed.mtimeMs) refuse('prepare-refused');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count));
  } finally { fs.closeSync(fd); }
}
function pinBinary() {
  const first = regular(cli), fd = fs.openSync(cli, 'r'), hash = crypto.createHash('sha256');
  try {
    const held = fs.fstatSync(fd);
    if (held.size !== 254858400 || held.ino !== first.ino || held.dev !== first.dev) refuse('binary-refused');
    const buffer = Buffer.alloc(1048576); let offset = 0;
    for (;;) {
      if (performance.now() - begin >= 5000) refuse('phase-deadline');
      const count = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (count === 0) break;
      offset += count; hash.update(buffer.subarray(0, count));
    }
    const after = fs.fstatSync(fd), named = regular(cli);
    if (after.size !== held.size || after.ctimeMs !== held.ctimeMs || after.mtimeMs !== held.mtimeMs ||
        named.ino !== held.ino || named.dev !== held.dev || offset !== held.size) refuse('binary-changed');
    result.cliSha256 = hash.digest('hex');
    if (result.cliSha256 !== expectedSha) refuse('binary-refused');
  } finally { fs.closeSync(fd); }
}
function scratchBudget() {
  let files = 0, bytes = 0;
  function walk(selected, depth) {
    if (depth > 8) refuse('scratch-limit');
    for (const name of fs.readdirSync(selected)) {
      if (++files > 256) refuse('scratch-limit');
      const child = path.join(selected, name), st = fs.lstatSync(child);
      if (st.isSymbolicLink()) refuse('scratch-limit');
      if (st.isDirectory()) walk(child, depth + 1);
      else if (st.isFile()) { bytes += st.size; if (bytes > 16777216) refuse('scratch-limit'); }
      else refuse('scratch-limit');
    }
  }
  walk(p.ROOT, 0);
}
function client(args, env) {
  return new Promise(resolve => {
    const start = performance.now(), chunks = []; let settled = false, hard = null;
    function finish(observation) {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(hard); currentChild = null;
      result.clientMilliseconds = Math.ceil(performance.now() - start); resolve(observation);
    }
    function terminate(code) {
      if (!result.failure) result.failure = code;
      try { currentChild?.kill(); } catch { /* Native owner must still confirm Job closure. */ }
      if (!hard) hard = setTimeout(() => finish({ observed: false, code: null, text: '' }), 1000);
    }
    const timer = setTimeout(() => { result.deadlineExpired = true; terminate('client-timeout'); }, 30000);
    try { currentChild = spawn(cli, args, { cwd: p.ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { finish({ observed: false, code: null, text: '' }); return; }
    currentChild.stdout.on('data', bytes => {
      result.stdoutBytes += bytes.length;
      if (result.stdoutBytes > 65536) { result.outputLimit = true; terminate('client-output-limit'); }
      else chunks.push(bytes);
    });
    currentChild.stderr.on('data', bytes => {
      result.stderrBytes += bytes.length;
      if (result.stderrBytes > 4096) { result.outputLimit = true; terminate('client-output-limit'); }
    });
    currentChild.on('error', () => terminate('client-failed'));
    currentChild.on('close', code => {
      let text = '';
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { result.failure ||= 'result-refused'; }
      finish({ observed: Number.isInteger(code), code: Number.isInteger(code) ? code : null, text });
    });
  });
}
async function run() {
  try {
    const root = fs.lstatSync(p.ROOT);
    if (!root.isDirectory() || root.isSymbolicLink() || fs.readdirSync(p.ROOT).length !== 0 ||
        fs.realpathSync.native(p.ROOT).toLowerCase() !== path.resolve(p.ROOT).toLowerCase()) refuse('prepare-refused');
    for (const leaf of ['profile', 'config', 'temp']) fs.mkdirSync(`${p.ROOT}/${leaf}`);
    fs.writeFileSync(p.SOURCE, p.BEFORE, { flag: 'wx' });
    const settings = `${p.ROOT}/settings.json`, mcp = `${p.ROOT}/mcp.json`;
    fs.writeFileSync(settings, '{}', { flag: 'wx' }); fs.writeFileSync(mcp, '{"mcpServers":{}}', { flag: 'wx' });
    pinBinary();
    let endpoint;
    try { endpoint = p.endpoint(JSON.parse(small(`${p.TRUSTED}/claude-endpoint.json`, 256))); }
    catch { refuse('endpoint-refused'); }
    const api = `http://127.0.0.1:${endpoint.port}`;
    const env = { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', COMSPEC: 'C:\\Windows\\System32\\cmd.exe', PATHEXT: '.COM;.EXE;.BAT;.CMD',
      PATH: `${p.TRUSTED};C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Windows\\System32`,
      USERPROFILE: `${p.ROOT}/profile`, HOME: `${p.ROOT}/profile`, APPDATA: `${p.ROOT}/profile`, LOCALAPPDATA: `${p.ROOT}/profile`,
      TEMP: `${p.ROOT}/temp`, TMP: `${p.ROOT}/temp`, CLAUDE_CONFIG_DIR: `${p.ROOT}/config`,
      ANTHROPIC_API_KEY: `aegis-fixture-${endpoint.nonce}`, ANTHROPIC_BASE_URL: api,
      HTTP_PROXY: api, HTTPS_PROXY: api, ALL_PROXY: api, NO_PROXY: '127.0.0.1,localhost',
      CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY: '1',
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1', DISABLE_UPDATES: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
      CLAUDE_CODE_ENABLE_TELEMETRY: '0', CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      BASH_DEFAULT_TIMEOUT_MS: '10000', BASH_MAX_TIMEOUT_MS: '10000', BASH_MAX_OUTPUT_LENGTH: '8192', IS_DEMO: '1', CI: '1' };
    const args = ['--restricted', '--setting-sources', '', '--settings', settings, '--strict-mcp-config', '--mcp-config', mcp,
      '--disallowedTools', 'mcp__*', '--no-chrome', '--no-session-persistence', '--permission-mode', 'dontAsk',
      '--tools', 'Read,Edit,PowerShell', '--allowedTools', `Read(${p.SOURCE})`, `Edit(${p.SOURCE})`, `PowerShell(${p.COMMAND})`,
      '--model', 'claude-sonnet-4-6', '--max-turns', '4', '--output-format', 'json', '--print',
      'Read the disposable sum.cjs, replace subtraction with addition, run the fixed Node test, then reply AEGIS_CLAUDE_DONE.'];
    result.stage = 'client';
    monitor = setInterval(() => {
      try { scratchBudget(); } catch { result.failure ||= 'scratch-limit'; try { currentChild?.kill(); } catch { /* The failure stays recorded for native cleanup. */ } }
    }, 500);
    const observed = await client(args, env);
    result.cliExitObserved = observed.observed; result.cliExitCode = observed.code;
    if (result.failure || result.deadlineExpired || result.outputLimit || !observed.observed || observed.code !== 0 || result.stderrBytes !== 0)
      refuse(result.failure || 'client-failed');
    result.stage = 'result'; result.clientResultValid = p.clientOutput(observed.text);
    if (!result.clientResultValid) refuse('result-refused');
    result.stage = 'verify';
    result.taskObservedEditedBytesMatch = small(p.SOURCE, 256) === p.AFTER;
    if (!result.taskObservedEditedBytesMatch) refuse('edit-refused');
    const tested = spawnSync(process.execPath, ['--test', `${p.TRUSTED}/claude-sum.test.cjs`],
      { cwd: p.ROOT, env, windowsHide: true, timeout: 3000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'] });
    result.taskObservedTestExitCode = Number.isInteger(tested.status) ? tested.status : null;
    if (tested.error || tested.status !== 0 || tested.stderr?.length || !tested.stdout?.toString('utf8').includes(p.MARKER)) refuse('test-refused');
    scratchBudget();
    if (result.failure || performance.now() - begin >= 41000) refuse(result.failure || 'phase-deadline');
    result.taskObservedReadEditTestPassed = true; result.passed = true; result.stage = 'complete';
  } catch (error) { result.passed = false; result.failure ||= codes.has(error.message) ? error.message : 'prepare-refused'; }
  finally {
    clearInterval(monitor); result.elapsedMilliseconds = Math.ceil(performance.now() - begin);
    const text = JSON.stringify(result);
    if (Buffer.byteLength(text) > 8192) process.exit(3);
    try { fs.writeFileSync('C:/AegisLab/work/claude-result.json', text, { flag: 'wx' }); }
    catch { process.exit(4); }
    process.exitCode = result.passed ? 0 : 1;
  }
}
run();
