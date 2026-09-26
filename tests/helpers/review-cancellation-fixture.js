import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, vi } from 'vitest';
const require = createRequire(import.meta.url);
const execution = require('../../src/main/action-execution');
const confirmation = require('../../src/main/action-confirmation');
const terminal = require('../../src/main/action-confirmation-terminal');
const broker = require('../../src/main/action-mcp-review');
const relay = require('../../src/main/action-mcp-connect');
const { startActionObservation } = require('../../src/main/action-observation-server');
const { observeActionRoute } = require('../../src/main/action-observation-client');
/** @param {Function} assertion Observable checkpoint. @returns {Promise<unknown>} Bounded wait. @since v0.15.1 */
export const wait = (assertion) => vi.waitFor(assertion, { timeout: 3500, interval: 25 });

/** Real broker, relay, terminal parser and child; only TTY streams/process are simulated.
 * @param {string} selection Selection kind. @param {Function[]} cleanups Cleanup stack.
 * @returns {Promise<object>} Private test controls. @since v0.15.1 */
export async function reviewFixture(selection, cleanups) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-review-cancel-'));
  const markers = ['PRIVATE_FIRST', 'PRIVATE_SECOND'].map((name) => path.join(root, name));
  const actions = markers.map((marker, index) => {
    const action = {
      executable: process.execPath,
      cwd: root,
      args: [
        '-e',
        `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},'x');` +
          `const t=setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),50);` +
          'setTimeout(()=>{clearInterval(t);process.exit(0)},8000);',
      ],
      env:
        process.platform === 'win32'
          ? { SYSTEMROOT: process.env.SystemRoot, WINDIR: process.env.SystemRoot }
          : {},
    };
    const policyPath = path.join(root, `policy-${index}.json`);
    const requestPath = path.join(root, `request-${index}.json`);
    fs.writeFileSync(
      policyPath,
      JSON.stringify({ schemaVersion: 2, defaultDecision: 'ask', rules: [] }),
    );
    fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, action }));
    return { id: index ? 'second' : 'first', policyPath, requestPath };
  });
  cleanups.push(() => {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const catalog = path.join(root, 'catalog.json');
  fs.writeFileSync(catalog, JSON.stringify({ schemaVersion: 1, actions }));
  const endpoint = path.join(root, 'PRIVATE_RELAY.json');
  const observation = path.join(root, 'PRIVATE_OBSERVATION.json');
  const source = await startActionObservation(observation, 'mcp-review', selection);
  cleanups.push(() => source.close());
  const input = new PassThrough(),
    output = new PassThrough(),
    terminalInput = new PassThrough();
  const host = new EventEmitter(),
    relayHost = new EventEmitter();
  const prompts = [],
    reports = [],
    launches = [],
    messages = [];
  let transcript = '',
    partial = '';
  const terminalOutput = new Writable({
    write(chunk, encoding, callback) {
      const challenge = chunk.toString().match(/Type (RUN [a-f0-9]{8}) to launch/);
      if (challenge) prompts.push(challenge[1]);
      callback();
    },
  });
  terminalInput.isTTY = terminalOutput.isTTY = true;
  terminal._setDepsForTest({ input: terminalInput, output: terminalOutput, process: host });
  execution._setDepsForTest({
    spawn: (...args) => {
      const child = spawn(...args);
      const item = { child, exited: false, closed: false };
      launches.push(item);
      child.once('exit', () => {
        item.exited = true;
      });
      child.once('close', () => {
        item.closed = true;
      });
      return child;
    },
  });
  const readyOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  broker._setDepsForTest({
    process: host,
    output: readyOutput,
    execute: async (...args) => {
      const result = await confirmation.confirmSelectedAction(...args);
      reports.push(result);
      return result;
    },
  });
  relay._setDepsForTest({ input, output, process: relayHost });
  let relayDone;
  const ownerDone = broker.handleActionMcpReview(
    selection === 'catalog'
      ? ['--action-mcp-catalog-review', catalog, endpoint]
      : ['--action-mcp-review', actions[0].policyPath, actions[0].requestPath, endpoint],
    { observe: source.observe },
  );
  cleanups.push(async () => {
    input.end();
    host.emit('SIGTERM');
    for (const item of launches) if (!item.exited) item.child.kill('SIGKILL');
    await Promise.all([ownerDone, relayDone]);
    for (const item of launches) await wait(() => expect(item.closed).toBe(true));
    for (const stream of [input, output, terminalInput, terminalOutput, readyOutput])
      stream.destroy();
    broker._resetForTest();
    relay._resetForTest();
    terminal._resetForTest();
    execution._resetForTest();
  });
  output.on('data', (chunk) => {
    transcript += chunk;
    expect(transcript.length).toBeLessThan(32768);
    partial += chunk;
    while (partial.includes('\n')) {
      const index = partial.indexOf('\n');
      messages.push(JSON.parse(partial.slice(0, index)));
      partial = partial.slice(index + 1);
    }
  });
  await wait(() => expect(fs.existsSync(endpoint)).toBe(true));
  relayDone = relay.handleActionMcpConnect(['--action-mcp-connect', endpoint]);
  const observer = observeActionRoute(observation);
  cleanups.push(() => observer.close());
  const send = (value) => input.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
  send({
    id: 10,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'review-cancellation-fixture', version: '1' },
    },
  });
  await wait(() => expect(messages.find((m) => m.id === 10)?.result).toBeDefined());
  send({ method: 'notifications/initialized' });
  await wait(() => expect(observer.snapshot().state).toBe('observed'));
  const before = observer.snapshot();
  return {
    root,
    markers,
    endpoint,
    observation,
    input,
    terminalInput,
    prompts,
    reports,
    launches,
    messages,
    observer,
    before,
    send,
    source,
    ownerDone,
    relayDone,
    transcript: () => transcript,
  };
}
