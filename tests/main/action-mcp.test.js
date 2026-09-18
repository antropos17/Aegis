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
function setup(execute = vi.fn(async () => ok)) {
  api._setDepsForTest({ execute });
  return {
    server: api.createActionMcp({ policyPath: 'PRIVATE_POLICY', requestPath: 'PRIVATE_REQUEST' }),
    execute,
  };
}
async function ready(server) {
  await server.receive(init());
  await server.receive(notification('notifications/initialized'));
}
afterEach(() => api._resetForTest());
describe('selected-action MCP protocol', () => {
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
    const { server, execute } = setup();
    await ready(server);
    const result = await server.receive(call(1));
    expect(execute).toHaveBeenCalledWith('PRIVATE_POLICY', 'PRIVATE_REQUEST', {
      signal: expect.any(AbortSignal),
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
