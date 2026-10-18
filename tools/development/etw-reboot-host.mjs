import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Use one explicit UAC decision for a bounded fixed-helper qualification phase.
 * The endpoint stays in memory, is never copied into a receipt, and dies with the host.
 * @param {string} helper @param {string} output @param {object} env
 * @param {Function} action Normal-token phase runner.
 * @returns {Promise<object>} Action result and finite host closure observation. @since v0.19.2
 */
export async function withRebootHost(helper, output, env, action) {
  assert(!env.AEGIS_ETW_QUALIFICATION_HOST, 'A fresh explicitly consented host is required');
  const launcher = spawn(helper, ['qualification-launcher', output], {
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
  createInterface({ input: launcher.stdout }).on('line', (line) => {
    bytes += Buffer.byteLength(line);
    if (bytes > 16384 || messages.length >= 2 || line.length > 8192) {
      failure = 'Host output budget';
      launcher.stdin.end('finish\n');
      return;
    }
    try {
      messages.push(JSON.parse(line));
    } catch {
      failure = 'Invalid host frame';
    }
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
      !failure && ready && /^[a-f0-9]{32}:[1-9]\d*:[1-9]\d*$/.test(ready.address),
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
    },
  };
}
