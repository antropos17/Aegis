import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const execution = require('../../src/main/action-execution');
const { serveActionMcp } = require('../../src/main/action-mcp-stdio');
const { startActionObservation } = require('../../src/main/action-observation-server');
const { observeActionRoute } = require('../../src/main/action-observation-client');
const cleanups = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = (assertion) => vi.waitFor(assertion, { timeout: 3000, interval: 25 });
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  } finally {
    execution._resetForTest();
  }
});

async function fixture(selection) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-running-cancel-'));
  cleanups.push(() => {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const marker = path.join(root, 'PRIVATE_EFFECT');
  const otherMarker = path.join(root, 'PRIVATE_OTHER');
  const files = ['first', 'second'].map((id, index) => {
    const requestPath = path.join(root, id + '-request.json');
    const policyPath = path.join(root, id + '-policy.json');
    const target = index === 0 ? marker : otherMarker;
    const action = {
      executable: process.execPath,
      cwd: root,
      args: [
        '-e',
        `const fs=require('node:fs');const p=${JSON.stringify(target)};fs.writeFileSync(p,'x');setInterval(()=>fs.appendFileSync(p,'x'),50);`,
      ],
      env:
        process.platform === 'win32'
          ? {
              SYSTEMROOT: process.env.SystemRoot,
              WINDIR: process.env.SystemRoot,
              TEMP: root,
              TMP: root,
            }
          : {},
    };
    fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, action }));
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        schemaVersion: 2,
        defaultDecision: 'deny',
        rules: [{ action, decision: 'allow' }],
      }),
    );
    return { id, requestPath, policyPath };
  });
  const catalogPath = path.join(root, 'catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify({ schemaVersion: 1, actions: files }));
  const endpoint = path.join(root, 'PRIVATE_OBSERVATION.json');
  const server = await startActionObservation(endpoint, 'mcp-stdio', selection);
  cleanups.push(() => server.close());
  const launches = [],
    reports = [];
  // Only observe spawn/exit through the existing seam; arguments and real child are unchanged.
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
  const input = new PassThrough(),
    output = new PassThrough();
  const messages = [];
  let buffer = '',
    transcript = '';
  output.on('data', (chunk) => {
    transcript += chunk;
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n');
      messages.push(JSON.parse(buffer.slice(0, end)));
      buffer = buffer.slice(end + 1);
    }
  });
  const serving = serveActionMcp({
    input,
    output,
    observe: server.observe,
    ...(selection === 'catalog'
      ? { catalogPath }
      : {
          policyPath: files[0].policyPath,
          requestPath: files[0].requestPath,
        }),
    execute: async (...args) => {
      const report = await execution.executeAction(...args);
      reports.push(report);
      return report;
    },
  });
  cleanups.push(async () => {
    input.end();
    // Cleanup only held, directly spawned test children, never a PID from a file.
    for (const item of launches) if (!item.exited) item.child.kill('SIGKILL');
    await serving;
    input.destroy();
    output.destroy();
  });
  const observer = observeActionRoute(endpoint);
  cleanups.push(() => observer.close());
  const send = (message) => input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  let id = 10;
  const request = async (method, params) => {
    const current = id++;
    send({ id: current, method, ...(params ? { params } : {}) });
    await wait(() => expect(messages.some((m) => m.id === current)).toBe(true));
    return messages.find((m) => m.id === current);
  };
  const status = async () => {
    const reply = await request('tools/call', { name: 'aegis_route_status', arguments: {} });
    expect(reply.result.isError).toBe(false);
    expect(JSON.parse(reply.result.content[0].text)).toEqual(reply.result.structuredContent);
    return reply.result.structuredContent;
  };
  await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'aegis-cancellation-fixture', version: '1' },
  });
  send({ method: 'notifications/initialized' });
  await wait(() => expect(observer.snapshot().state).toBe('observed'));
  const before = observer.snapshot();
  expect(before.snapshot).toMatchObject({
    actionAttempts: 0,
    ownerInvocations: 0,
    ownerSettled: 0,
    cancellationRequests: 0,
    selection,
    selectedActionCount: selection === 'catalog' ? 2 : 1,
  });
  return {
    root,
    marker,
    otherMarker,
    endpoint,
    server,
    launches,
    reports,
    input,
    messages,
    serving,
    observer,
    before,
    send,
    status,
    transcript: () => transcript,
  };
}

it.each(['single-action', 'catalog'])(
  '%s: exact MCP cancellation interrupts a running child and observation settles once',
  async (selection) => {
    const f = await fixture(selection);
    f.send({
      id: 1,
      method: 'tools/call',
      params: {
        name: selection === 'catalog' ? 'aegis_action_first' : 'aegis_execute_selected',
        arguments: {},
      },
    });
    await wait(() => expect(fs.existsSync(f.marker)).toBe(true));
    await wait(() =>
      expect(f.observer.snapshot().snapshot).toMatchObject({
        actionAttempts: 1,
        ownerInvocations: 1,
        ownerSettled: 0,
        cancellationRequests: 0,
      }),
    );
    expect(f.launches).toHaveLength(1);
    const owned = f.launches[0];
    expect(owned.exited).toBe(false);
    const cancel = (requestId) =>
      f.send({ method: 'notifications/cancelled', params: { requestId } });
    // Different JSON type and unrelated ID must leave the same live child untouched.
    cancel('1');
    cancel(999);
    expect(await f.status()).toMatchObject({ activity: 'owner-pending', cancellationRequests: 0 });
    const size = fs.statSync(f.marker).size;
    await wait(() => expect(fs.statSync(f.marker).size).toBeGreaterThan(size));
    expect(owned.exited).toBe(false);
    cancel(1);
    cancel(1);
    await wait(() => expect(f.reports).toHaveLength(1));
    expect(f.reports[0]).toMatchObject({
      decision: 'allow',
      reason: 'action-cancelled',
      execution: { state: 'interrupted', termination: 'confirmed' },
      control: 'direct-child-only',
      descendantControl: 'unsupported',
    });
    expect(owned.exited).toBe(true);
    expect(owned.closed).toBe(true);
    await wait(() =>
      expect(f.observer.snapshot().snapshot).toMatchObject({
        actionAttempts: 1,
        ownerInvocations: 1,
        ownerSettled: 1,
        ownerFailures: 0,
        cancellationRequests: 1,
      }),
    );
    const after = f.observer.snapshot();
    expect(after.snapshot.connectionId).toBe(f.before.snapshot.connectionId);
    expect(after.snapshot.sequence).toBeGreaterThan(f.before.snapshot.sequence);
    expect(after.snapshot.client).toEqual(f.before.snapshot.client);
    const status = await f.status();
    expect(status).toMatchObject({
      activity: 'idle',
      ownerSettled: 1,
      cancellationRequests: 1,
      providerIdentity: 'unverified',
      blockingVerification: 'not-performed',
    });
    expect(status).not.toHaveProperty('termination');
    const finalSize = fs.statSync(f.marker).size;
    await pause(100);
    expect(fs.statSync(f.marker).size).toBe(finalSize);
    expect(fs.existsSync(f.otherMarker)).toBe(false);
    expect(f.messages.some((m) => m.id === 1)).toBe(false);
    // Retrying the cancelled request ID cannot execute the action again.
    f.send({
      id: 1,
      method: 'tools/call',
      params: {
        name: selection === 'catalog' ? 'aegis_action_second' : 'aegis_execute_selected',
        arguments: {},
      },
    });
    await wait(() => expect(f.messages.find((m) => m.id === 1)?.error?.code).toBe(-32600));
    expect(f.messages.filter((m) => m.id === 1)).toHaveLength(1);
    expect(f.launches).toHaveLength(1);
    expect((await f.status()).actionAttempts).toBe(1);
    f.input.end();
    expect(await f.serving).toBe(0);
    await f.server.close();
    await wait(() => expect(f.observer.snapshot().state).toBe('coverage-lost'));
    const lost = f.observer.snapshot();
    expect(lost.snapshot.ownerSettled).toBe(1);
    expect(lost.snapshot.cancellationRequests).toBe(1);
    await pause(100);
    expect(f.observer.snapshot()).toEqual(lost);
    expect(fs.existsSync(f.endpoint)).toBe(false);
    expect(f.transcript()).not.toContain(f.root);
    expect(f.transcript()).not.toMatch(/PRIVATE|action-cancelled|termination/);
    expect(JSON.stringify([f.before, after, lost])).not.toMatch(
      /PRIVATE|token|policyPath|termination/,
    );
  },
  12000,
);
