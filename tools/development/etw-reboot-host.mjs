import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const STARTUP_STAGES = new Set([
  'guard-connect',
  'guard-broker',
  'guard-reserve',
  'fallback-connect',
  'fallback-broker',
  'fallback-reserve',
]);
const COLLECTOR_STAGES = new Set([
  ...STARTUP_STAGES,
  'peer',
  'pipeline',
  'guard',
  'fallback',
  'custody',
  'hello',
  'authorize',
  'trace-start',
  'guard-arm',
  'capture-start',
  'trace-enable',
  'trace-query',
  'ready',
  'running',
  'stop',
]);
const int32 = (value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;

function finiteChildDiagnostics(value) {
  const codes = value.childExitCodes,
    diagnostics = value.childDiagnostics;
  return (
    Array.isArray(codes) &&
    codes.length <= 64 &&
    codes.every(int32) &&
    Array.isArray(diagnostics) &&
    diagnostics.length === codes.length &&
    diagnostics.filter((entry) => entry !== null).length <= 4 &&
    diagnostics.every(
      (entry, index) =>
        entry === null ||
        (codes[index] !== 0 &&
          entry !== null &&
          typeof entry === 'object' &&
          Object.keys(entry).length === 3 &&
          ['stage', 'kind', 'code'].every((key) => Object.hasOwn(entry, key)) &&
          COLLECTOR_STAGES.has(entry.stage) &&
          (['win32', 'hresult'].includes(entry.kind) ||
            (entry.kind === 'peer-exit' && STARTUP_STAGES.has(entry.stage))) &&
          int32(entry.code)),
    )
  );
}

/** Use one explicit UAC decision for a bounded fixed-helper qualification phase.
 * The endpoint stays in memory, is never copied into a receipt, and dies with the host.
 * @param {string} helper @param {string} output @param {object} env
 * @param {Function} action Normal-token phase runner.
 * @returns {Promise<object>} Action result and finite host closure observation. @since v0.19.2
 */
export async function withRebootHost(helper, output, env, action, deps = {}) {
  assert(!env.AEGIS_ETW_QUALIFICATION_HOST, 'A fresh explicitly consented host is required');
  const launcher = (deps.spawnProcess ?? spawn)(helper, ['qualification-launcher', output], {
    cwd: output,
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const messages = [];
  let bytes = 0,
    closed = false,
    code = null,
    failure = null,
    result;
  launcher.stdin.on('error', () => {});
  launcher.on('error', (error) => {
    failure = error.code ?? 'Launcher start failed';
    closed = true;
  });
  launcher.on('close', (value) => {
    code = value;
    closed = true;
  });
  let buffered = '';
  launcher.stdout.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 16384) {
      failure = 'Host output budget';
      launcher.stdin.end('finish\n');
      return;
    }
    buffered += chunk.toString('utf8');
    while (buffered.includes('\n')) {
      const end = buffered.indexOf('\n'),
        line = buffered.slice(0, end).replace(/\r$/, '');
      buffered = buffered.slice(end + 1);
      if (messages.length >= 2 || line.length > 8192) {
        failure = 'Host output budget';
        break;
      }
      try {
        const value = JSON.parse(line);
        const keys =
          value.type === 'host-ready'
            ? ['type', 'address']
            : value.type === 'host-finished'
              ? [
                  'type',
                  'launches',
                  'liveChildren',
                  'childExitCodes',
                  'exitCode',
                  ...(Object.hasOwn(value, 'childDiagnostics') ? ['childDiagnostics'] : []),
                ]
              : [];
        assert(
          keys.length &&
            value.type === (messages.length === 0 ? 'host-ready' : 'host-finished') &&
            Object.keys(value).length === keys.length &&
            keys.every((k) => Object.hasOwn(value, k)),
        );
        if (Object.hasOwn(value, 'childDiagnostics')) assert(finiteChildDiagnostics(value));
        messages.push(value);
      } catch {
        failure = 'Invalid host frame';
        break;
      }
    }
    if (buffered.length > 8192) failure = 'Host output budget';
  });
  launcher.stderr.on('data', (chunk) => {
    bytes += chunk.length;
    failure = 'Unexpected host stderr';
    launcher.stdin.end('finish\n');
  });
  try {
    console.log('One manual UAC confirmation is required for this phase (about two minutes).');
    const until = Date.now() + 135000;
    while (
      !closed &&
      !failure &&
      !messages.some((m) => m.type === 'host-ready') &&
      Date.now() < until
    )
      await delay(100);
    const ready = messages.find((m) => m.type === 'host-ready');
    assert(
      !failure &&
        !closed &&
        ready &&
        /^[a-f0-9]{32}:[1-9]\d{0,9}:[1-9]\d{0,18}$/.test(ready.address),
      'Host consent/startup unverified',
    );
    result = await action({ ...env, AEGIS_ETW_QUALIFICATION_HOST: ready.address });
  } catch (error) {
    failure ??= error.message;
  } finally {
    launcher.stdin.end('finish\n');
    const until = Date.now() + 45000;
    while (!closed && Date.now() < until) await delay(100);
  }
  const finish = messages.find((m) => m.type === 'host-finished');
  return {
    result,
    failure,
    host: {
      exitCode: closed && code === 0 && finish?.exitCode === 0 ? 0 : null,
      launches: finish?.launches ?? null,
      liveChildren: finish?.liveChildren ?? null,
      childExitCodes: finish?.childExitCodes ?? [],
      ...(finish && Object.hasOwn(finish, 'childDiagnostics')
        ? { childDiagnostics: finish.childDiagnostics }
        : {}),
    },
  };
}
