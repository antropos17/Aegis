import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const api = require('../../src/main/action-mcp');
const ok = {
  schemaVersion: 1,
  mode: 'action-exec',
  decision: 'allow',
  reason: 'child-exited',
  execution: { state: 'exited', exitCode: 0, outputComplete: true },
  control: 'direct-child-only',
  descendantControl: 'unsupported',
};
const request = (id, method, params) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params ? { params } : {}),
});
const call = (id, argumentsValue = {}) =>
  request(id, 'tools/call', { name: api.NAME, arguments: argumentsValue });
const init = (id = 0, version = api.VERSIONS[0]) =>
  request(id, 'initialize', {
    protocolVersion: version,
    capabilities: {},
    clientInfo: { name: 'PRIVATE_CLIENT', version: '1' },
  });
const notification = (method, params) => ({
  jsonrpc: '2.0',
  method,
  ...(params ? { params } : {}),
});
function setup(execute = vi.fn(async () => ok), overrides = {}) {
  const binding = Object.freeze({ PRIVATE_BINDING: true });
  const capture = vi.fn(async () => binding);
  const revoke = vi.fn();
  api._setDepsForTest({ execute, capture, revoke, ...overrides });
  return {
    server: api.createActionMcp({ policyPath: 'PRIVATE_POLICY', requestPath: 'PRIVATE_REQUEST' }),
    execute,
    binding,
    capture,
    revoke,
  };
}
async function ready(server) {
  await server.receive(init());
  await server.receive(notification('notifications/initialized'));
}
afterEach(() => api._resetForTest());
describe('connection-owned selected-file binding', () => {
  it('waits for capture and ignores premature initialized notifications', async () => {
    let complete;
    const captured = Object.freeze({ PRIVATE_HANDLE: true });
    const capture = vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { server, execute } = setup(undefined, { capture });
    let resolved = false;
    const pending = server.receive(init()).then((result) => {
      resolved = true;
      return result;
    });
    await server.receive(notification('notifications/initialized'));
    expect((await server.receive(call(1))).error.code).toBe(-32002);
    expect((await server.receive(init(2))).error.code).toBe(-32600);
    expect(resolved).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    complete(captured);
    expect((await pending).result.serverInfo.version).toBe('1.1.0');
    expect((await server.receive(call(3))).error.code).toBe(-32002);
    await server.receive(notification('notifications/initialized'));
    await server.receive(call(4));
    expect(execute).toHaveBeenCalledExactlyOnceWith('PRIVATE_POLICY', 'PRIVATE_REQUEST', {
      signal: expect.any(AbortSignal),
      binding: captured,
    });
    expect(capture).toHaveBeenCalledOnce();
  });

  it('captures once and passes the opaque binding only through trusted execution options', async () => {
    const { server, execute, capture, binding } = setup();
    const initialized = await server.receive(init());
    expect(capture).toHaveBeenCalledExactlyOnceWith('PRIVATE_POLICY', 'PRIVATE_REQUEST', {
      signal: expect.any(AbortSignal),
    });
    await server.receive(notification('notifications/initialized'));
    const listed = await server.receive(request(1, 'tools/list'));
    const first = await server.receive(call(2));
    const second = await server.receive(call(3));
    expect(execute.mock.calls.every((args) => args[2].binding === binding)).toBe(true);
    expect(capture).toHaveBeenCalledOnce();
    expect(JSON.stringify([initialized, listed, first, second])).not.toContain('PRIVATE');
  });

  it('makes failed capture permanent for this connection without leaking errors', async () => {
    const capture = vi.fn(async () => {
      throw new Error('PRIVATE_FILE_CONTENT');
    });
    const { server, execute } = setup(undefined, { capture });
    const result = await server.receive(init());
    expect(result).toEqual({
      jsonrpc: '2.0',
      id: 0,
      error: { code: -32000, message: 'Configuration unavailable' },
    });
    await server.receive(notification('notifications/initialized'));
    expect((await server.receive(call(1))).error.code).toBe(-32002);
    expect((await server.receive(init(2))).error.code).toBe(-32600);
    expect(capture).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it.each([null, undefined, 'PRIVATE', []])(
    'rejects an invalid captured capability %#',
    async (value) => {
      const { server, execute } = setup(undefined, { capture: async () => value });
      expect((await server.receive(init())).error).toEqual({
        code: -32000,
        message: 'Configuration unavailable',
      });
      await server.receive(notification('notifications/initialized'));
      expect((await server.receive(call(1))).error).toBeDefined();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('aborts pending capture on close and revokes a late result without initialization output', async () => {
    let complete, signal;
    const captured = Object.freeze({ PRIVATE_HANDLE: true });
    const { server, revoke, execute } = setup(undefined, {
      capture: (_p, _r, options) => {
        signal = options.signal;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    });
    const pending = server.receive(init());
    server.close();
    expect(signal.aborted).toBe(true);
    complete(captured);
    expect(await pending).toBeNull();
    expect(revoke).toHaveBeenCalledExactlyOnceWith(captured);
    expect(await server.receive(init(1))).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('suppresses a failed capture response after close', async () => {
    let fail;
    const { server, revoke } = setup(undefined, {
      capture: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    });
    const pending = server.receive(init());
    server.close();
    fail(new Error('PRIVATE_ABORT_ERROR'));
    expect(await pending).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('revokes exactly once on close and on lifetime admission shutdown', async () => {
    const first = setup();
    await ready(first.server);
    first.server.close();
    first.server.close();
    expect(first.revoke).toHaveBeenCalledExactlyOnceWith(first.binding);
    const second = setup();
    await ready(second.server);
    for (let i = 0; i < api.LIMITS.messages; i++)
      await second.server.receive(notification('unknown'));
    expect(second.revoke).toHaveBeenCalledExactlyOnceWith(second.binding);
    expect(await second.server.receive(call(1))).toBeNull();
  });
});

describe('selected-action MCP protocol', () => {
  it('uses a per-instance trusted execution callback that protocol input cannot replace', async () => {
    const fallback = vi.fn(async () => ok);
    setup(fallback);
    const execute = vi.fn(async () => ok);
    const server = api.createActionMcp({
      policyPath: 'PRIVATE_POLICY',
      requestPath: 'PRIVATE_REQUEST',
      execute,
    });
    await ready(server);
    expect(
      (
        await server.receive(
          request(1, 'tools/call', { name: api.NAME, arguments: {}, execute: 'PRIVATE_CALLBACK' }),
        )
      ).error.code,
    ).toBe(-32602);
    await server.receive(call(2));
    expect(execute).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    expect(execute.mock.calls[0][2]).toMatchObject({
      binding: expect.any(Object),
      signal: expect.any(AbortSignal),
    });
    server.close();
  });
  it.each(api.VERSIONS)(
    'negotiates %s and exposes one fixed argument-free tool',
    async (version) => {
      const { server, execute } = setup();
      const result = await server.receive(init(0, version));
      expect(result.result.protocolVersion).toBe(version);
      expect((await server.receive(call(1))).error).toBeDefined();
      await server.receive(notification('notifications/initialized'));
      const list = await server.receive(request(2, 'tools/list'));
      expect(list.result.tools).toHaveLength(1);
      expect(list.result.tools[0]).toMatchObject({
        name: api.NAME,
        inputSchema: { additionalProperties: false },
        annotations: { destructiveHint: true, idempotentHint: false },
      });
      expect(JSON.stringify(list)).not.toContain('PRIVATE');
      expect(execute).not.toHaveBeenCalled();
    },
  );
  it('negotiates an unsupported version to a supported server version', async () => {
    const { server } = setup();
    expect((await server.receive(init(0, 'future'))).result.protocolVersion).toBe(api.VERSIONS[0]);
  });
  it('does not execute before handshake or through an idless call', async () => {
    const { server, execute } = setup();
    await server.receive(notification('notifications/initialized'));
    expect((await server.receive(call(1))).error).toBeDefined();
    await ready(server);
    const noId = call(2);
    delete noId.id;
    expect(await server.receive(noId)).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
  it('calls only the selected files and returns fixed execution metadata', async () => {
    const { server, execute, binding } = setup();
    await ready(server);
    const result = await server.receive(call(1));
    expect(execute).toHaveBeenCalledWith('PRIVATE_POLICY', 'PRIVATE_REQUEST', {
      signal: expect.any(AbortSignal),
      binding,
    });
    expect(result.result).toMatchObject({ isError: false, structuredContent: ok });
    expect(JSON.parse(result.result.content[0].text)).toEqual(ok);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it.each([{ path: 'PRIVATE' }, { args: [] }, [], null, 'PRIVATE'])(
    'rejects client-controlled action input',
    async (args) => {
      const { server, execute } = setup();
      await ready(server);
      expect((await server.receive(call(1, args))).error.code).toBe(-32602);
      expect(execute).not.toHaveBeenCalled();
    },
  );
  it('consumes failed and successful request IDs without replaying side effects', async () => {
    const { server, execute } = setup();
    await ready(server);
    await server.receive(call(1, { invalid: true }));
    expect((await server.receive(call(1))).error).toBeDefined();
    await server.receive(call(2));
    expect((await server.receive(call(2))).error).toBeDefined();
    await server.receive(call('2'));
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('rejects concurrent execution without queuing and keeps busy IDs consumed', async () => {
    let finish;
    const execute = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { server } = setup(execute);
    await ready(server);
    const running = server.receive(call(1));
    expect((await server.receive(call(2))).error.message).toBe('Execution busy');
    finish(ok);
    await running;
    expect((await server.receive(call(2))).error).toBeDefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('cancels only the exact active ID and suppresses its late result', async () => {
    let finish, signal;
    const { server } = setup((_p, _r, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await ready(server);
    const running = server.receive(call(1));
    await server.receive(
      notification('notifications/cancelled', { requestId: '1', reason: 'PRIVATE' }),
    );
    expect(signal.aborted).toBe(false);
    await server.receive(
      notification('notifications/cancelled', { requestId: 1, reason: 'PRIVATE' }),
    );
    expect(signal.aborted).toBe(true);
    finish(ok);
    expect(await running).toBeNull();
    expect((await server.receive(call(1))).error).toBeDefined();
  });
  it('close aborts the active action and prevents every subsequent call', async () => {
    let finish, signal;
    const { server } = setup((_p, _r, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await ready(server);
    const running = server.receive(call(1));
    server.close();
    server.close();
    expect(signal.aborted).toBe(true);
    finish(ok);
    expect(await running).toBeNull();
    expect(await server.receive(call(2))).toBeNull();
  });
  it.each(['deny', 'ask'])(
    'marks %s as a tool error without turning it into execution',
    async (decision) => {
      const { server } = setup(async () => ({
        ...ok,
        decision,
        execution: { state: 'not-started' },
      }));
      await ready(server);
      expect((await server.receive(call(1))).result.isError).toBe(true);
    },
  );
  it('redacts unexpected errors and never claims that an unknown failure prevented execution', async () => {
    const { server } = setup(async () => {
      throw new Error('PRIVATE_SECRET');
    });
    await ready(server);
    const result = await server.receive(call(1));
    expect(result.result.isError).toBe(true);
    expect(result.result.content[0].text).toContain('may have started');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('bounds lifetime execution attempts', async () => {
    const { server, execute } = setup();
    await ready(server);
    for (let id = 1; id <= api.LIMITS.executions; id++) await server.receive(call(id));
    expect((await server.receive(call(99))).error.message).toBe('Execution limit reached');
    expect(execute).toHaveBeenCalledTimes(api.LIMITS.executions);
  });
  it('closes on lifetime message cap even for notifications', async () => {
    const { server, execute } = setup();
    for (let i = 0; i <= api.LIMITS.messages; i++) await server.receive(notification('unknown'));
    expect(await server.receive(init())).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    {},
    { jsonrpc: '1.0', id: 1, method: 'ping' },
    request(null, 'ping'),
    request('BAD\nID', 'ping'),
  ])('rejects malformed envelopes', async (value) => {
    const { server, execute } = setup();
    expect((await server.receive(value)).error.code).toBe(-32600);
    expect(execute).not.toHaveBeenCalled();
  });
});
