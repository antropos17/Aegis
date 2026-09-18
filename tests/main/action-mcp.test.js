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
function catalogSetup(overrides = {}, ownerExecute) {
  const cap = Object.freeze({ PRIVATE_CATALOG: true });
  const entries = ['first', 'second'].map((name) => ({
    name: 'aegis_action_' + name,
    policyPath: 'PRIVATE_POLICY_' + name,
    requestPath: 'PRIVATE_REQUEST_' + name,
    binding: Object.freeze({ PRIVATE_ENTRY: name }),
  }));
  const deps = {
    execute: vi.fn(async () => ok),
    capture: vi.fn(),
    revoke: vi.fn(),
    captureCatalog: vi.fn(async () => cap),
    revokeCatalog: vi.fn(),
    listCatalog: vi.fn(() =>
      entries.map(({ name }) => ({
        name,
        description: 'Operator selected action',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      })),
    ),
    selectCatalog: vi.fn((_cap, name) => entries.find((entry) => entry.name === name)),
    ...overrides,
  };
  api._setDepsForTest(deps);
  return {
    ...deps,
    entries,
    cap,
    server: api.createActionMcp({ catalogPath: 'PRIVATE_CATALOG_PATH', execute: ownerExecute }),
  };
}
const catalogCall = (id, name = 'first', args = {}) =>
  request(id, 'tools/call', { name: 'aegis_action_' + name, arguments: args });

describe('trusted selected-action catalog', () => {
  it('captures one catalog and selects separate private bindings without exposing them', async () => {
    const t = catalogSetup();
    const initialized = await t.server.receive(init());
    await t.server.receive(notification('notifications/initialized'));
    const listed = await t.server.receive(request(1, 'tools/list'));
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(
      t.entries.map((entry) => entry.name),
    );
    const first = await t.server.receive(catalogCall(2));
    const second = await t.server.receive(catalogCall(3, 'second'));
    for (const [i, entry] of t.entries.entries()) {
      expect(t.execute.mock.calls[i]).toEqual([
        entry.policyPath,
        entry.requestPath,
        { binding: entry.binding, signal: expect.any(AbortSignal) },
      ]);
    }
    expect(t.captureCatalog).toHaveBeenCalledExactlyOnceWith('PRIVATE_CATALOG_PATH', {
      signal: expect.any(AbortSignal),
    });
    expect(t.capture).not.toHaveBeenCalled();
    expect(JSON.stringify([initialized, listed, first, second])).not.toContain('PRIVATE');
    t.server.close();
    t.server.close();
    expect(t.revokeCatalog).toHaveBeenCalledExactlyOnceWith(t.cap);
    expect(t.revoke).not.toHaveBeenCalled();
  });

  it.each([{ policyPath: 'private' }, { requestPath: 'private' }])(
    'rejects mixed trusted selection %#',
    (extra) => {
      expect(() => api.createActionMcp({ catalogPath: 'catalog', ...extra })).toThrow(
        'catalog-owner-invalid',
      );
    },
  );

  it('shares replay IDs and execution budget across all catalog names', async () => {
    const t = catalogSetup();
    await ready(t.server);
    await t.server.receive(catalogCall(1));
    expect((await t.server.receive(catalogCall(1, 'second'))).error.message).toBe(
      'Duplicate request identifier',
    );
    for (let i = 2; i <= api.LIMITS.executions; i++)
      await t.server.receive(catalogCall(i, i % 2 ? 'first' : 'second'));
    expect((await t.server.receive(catalogCall(99, 'second'))).error.message).toBe(
      'Execution limit reached',
    );
    expect(t.execute).toHaveBeenCalledTimes(api.LIMITS.executions);
  });

  it('keeps busy and cancellation global across catalog names', async () => {
    let complete;
    const execute = vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const t = catalogSetup({ execute });
    await ready(t.server);
    const pending = t.server.receive(catalogCall(1));
    expect((await t.server.receive(catalogCall(2, 'second'))).error.message).toBe('Execution busy');
    expect(t.selectCatalog).toHaveBeenCalledTimes(1);
    await t.server.receive(notification('notifications/cancelled', { requestId: 1 }));
    expect(execute.mock.calls[0][2].signal.aborted).toBe(true);
    expect((await t.server.receive(catalogCall(3, 'second'))).error.message).toBe('Execution busy');
    complete(ok);
    expect(await pending).toBeNull();
    execute.mockResolvedValue(ok);
    expect((await t.server.receive(catalogCall(4, 'second'))).result.isError).toBe(false);
  });

  it.each([
    catalogCall(1, 'unknown'),
    catalogCall(1, 'first', { catalogPath: 'PRIVATE' }),
    request(1, 'tools/call', { name: 'aegis_action_first', requestPath: 'PRIVATE' }),
    call(1),
  ])('rejects client selection/configuration and arguments %#', async (message) => {
    const t = catalogSetup();
    await ready(t.server);
    expect((await t.server.receive(message)).error.code).toBe(-32602);
    expect(t.selectCatalog).not.toHaveBeenCalled();
    expect(t.execute).not.toHaveBeenCalled();
  });

  it('returns configuration error before execution when private selection is revoked', async () => {
    const t = catalogSetup({
      selectCatalog: vi.fn(() => {
        throw Error('PRIVATE_CAP_REVOKED');
      }),
    });
    await ready(t.server);
    const result = await t.server.receive(catalogCall(1));
    expect(result.error).toEqual({ code: -32000, message: 'Configuration unavailable' });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|may have started/);
    expect(t.execute).not.toHaveBeenCalled();
    expect((await t.server.receive(catalogCall(2, 'second'))).error.message).toBe(
      'Configuration unavailable',
    );
  });

  it('revokes a late catalog initialization with its correct owner', async () => {
    let complete, signal;
    const t = catalogSetup({
      captureCatalog: vi.fn((_path, options) => {
        signal = options.signal;
        return new Promise((resolve) => {
          complete = resolve;
        });
      }),
    });
    const pending = t.server.receive(init());
    t.server.close();
    expect(signal.aborted).toBe(true);
    complete(t.cap);
    expect(await pending).toBeNull();
    expect(t.revokeCatalog).toHaveBeenCalledExactlyOnceWith(t.cap);
    expect(t.revoke).not.toHaveBeenCalled();
  });

  it('makes failed catalog initialization permanent and private', async () => {
    const t = catalogSetup({
      captureCatalog: vi.fn(async () => {
        throw Error('PRIVATE_LOAD');
      }),
    });
    expect((await t.server.receive(init())).error.message).toBe('Configuration unavailable');
    expect((await t.server.receive(init(1))).error.message).toBe('Already initialized');
    expect(t.captureCatalog).toHaveBeenCalledTimes(1);
    expect(t.execute).not.toHaveBeenCalled();
  });

  it('revokes capture if initial catalog listing fails and sanitizes later listing errors', async () => {
    const t = catalogSetup({
      listCatalog: vi.fn(() => {
        throw Error('PRIVATE_LIST');
      }),
    });
    expect((await t.server.receive(init())).error.message).toBe('Configuration unavailable');
    expect(t.revokeCatalog).toHaveBeenCalledExactlyOnceWith(t.cap);
    const other = catalogSetup();
    await ready(other.server);
    other.listCatalog.mockImplementation(() => {
      throw Error('PRIVATE_LIST');
    });
    expect((await other.server.receive(request(1, 'tools/list'))).error).toEqual({
      code: -32000,
      message: 'Configuration unavailable',
    });
  });

  it('closes the entire catalog at the shared message budget', async () => {
    const t = catalogSetup();
    await ready(t.server);
    for (let i = 0; i < api.LIMITS.messages; i++) await t.server.receive(notification('unknown'));
    expect(t.revokeCatalog).toHaveBeenCalledExactlyOnceWith(t.cap);
    expect(await t.server.receive(catalogCall(1))).toBeNull();
  });

  it('uses a trusted owner executor for catalog review and aborts it on close', async () => {
    let complete;
    const owner = vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const t = catalogSetup({}, owner);
    await ready(t.server);
    const pending = t.server.receive(catalogCall(1, 'second'));
    expect(owner.mock.calls[0][2].binding).toBe(t.entries[1].binding);
    t.server.close();
    expect(owner.mock.calls[0][2].signal.aborted).toBe(true);
    expect(t.revokeCatalog).toHaveBeenCalledExactlyOnceWith(t.cap);
    complete(ok);
    expect(await pending).toBeNull();
    expect(t.execute).not.toHaveBeenCalled();
  });
});
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
