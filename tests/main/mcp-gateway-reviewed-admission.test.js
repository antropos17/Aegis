import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createMcpGateway } = require('../../src/main/mcp-gateway');
const fixture = fileURLToPath(new URL('./fixtures/mcp-gateway-server.cjs', import.meta.url));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
const init = () =>
  rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {} });
const call = (id, recipient) => rpc(id, 'tools/call', { name: 'record', arguments: { recipient } });
const objectSchema = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
let root, paths, manifest, session, previews, review, failed;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-reviewed-'));
  paths = Object.fromEntries(
    [
      'policy',
      'request',
      'manifest',
      'config',
      'effects',
      'started',
      'listed',
      'disclosure',
      'secrets',
      'store',
    ].map((name) => [name, path.join(root, name)]),
  );
  fs.mkdirSync(paths.store);
  const tool = {
    name: 'record',
    inputSchema: objectSchema({ recipient: { type: 'string', maxLength: 64 } }),
    outputSchema: objectSchema({ accepted: { type: 'boolean' } }),
  };
  const action = {
    executable: process.execPath,
    cwd: root,
    args: [fixture, paths.config],
    env:
      process.platform === 'win32'
        ? { SYSTEMROOT: process.env.SYSTEMROOT || process.env.SystemRoot }
        : {},
  };
  save(paths.policy, {
    schemaVersion: 2,
    defaultDecision: 'deny',
    rules: [{ action, decision: 'allow' }],
  });
  save(paths.request, { schemaVersion: 1, action });
  save(paths.config, { ...paths, tool, mode: 'normal' });
  save(paths.secrets, { schemaVersion: 1, values: ['Synthetic_Secret_847'] });
  save(paths.disclosure, { schemaVersion: 1, tools: [{ name: 'record', paths: ['/recipient'] }] });
  const time = Date.now();
  manifest = {
    schemaVersion: 2,
    tools: [tool],
    grants: ['chosen', 'other', 'other'].map((recipient, index) => ({
      id: String(index + 1).repeat(32),
      taskId: 't'.repeat(32),
      notBefore: time - 1000,
      expiresAt: time + 120000,
      tool: 'record',
      arguments: { recipient },
    })),
  };
  previews = [];
  review = vi.fn(async (preview) => {
    previews.push(JSON.parse(preview));
    return true;
  });
  failed = vi.fn();
});

afterEach(async () => {
  session?.close();
  if (session) expect(await session.finish()).toBe(true);
  session = undefined;
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

async function ready(options = {}) {
  save(paths.manifest, manifest);
  session = createMcpGateway({
    policyPath: paths.policy,
    requestPath: paths.request,
    manifestPath: paths.manifest,
    grantStorePath: paths.store,
    secretPolicyPath: paths.secrets,
    disclosurePolicyPath: paths.disclosure,
    reviewCall: review,
    onFailure: failed,
    ...options,
  });
  expect((await session.receive(init())).result).toBeDefined();
  await session.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
}
function effects() {
  return fs.existsSync(paths.effects)
    ? fs.readFileSync(paths.effects, 'utf8').trim().split('\n').map(JSON.parse)
    : [];
}

describe('reviewed gateway admission with an owned upstream', () => {
  it('asks on first, changed and unchanged calls using distinct one-use grants', async () => {
    await ready();
    for (const [id, recipient] of [
      [2, 'chosen'],
      [3, 'other'],
      [4, 'other'],
    ])
      expect((await session.receive(call(id, recipient))).result.structuredContent).toEqual({
        accepted: true,
      });
    expect(previews.map((item) => item.baseline)).toEqual([
      'none',
      'previous-owner-approved-call',
      'previous-owner-approved-call',
    ]);
    expect(previews[0].current).toEqual({ recipient: 'chosen' });
    expect(previews[1].changes).toEqual([
      { path: '/recipient', type: 'changed', before: 'chosen', after: 'other' },
    ]);
    expect(previews[2].changes).toEqual([]);
    expect(review).toHaveBeenCalledTimes(3);
    expect(effects().map((item) => item.arguments.recipient)).toEqual(['chosen', 'other', 'other']);
    expect((await session.receive(call(5, 'other'))).error.message).toBe(
      'gateway-grant-unavailable',
    );
  });

  it('does not treat a denial as a prior approval or restore its consumed grant', async () => {
    review.mockImplementationOnce(async (preview) => {
      previews.push(JSON.parse(preview));
      return false;
    });
    await ready();
    expect((await session.receive(call(2, 'chosen'))).error.message).toBe(
      'gateway-review-declined',
    );
    expect(effects()).toEqual([]);
    expect((await session.receive(call(3, 'chosen'))).error.message).toBe(
      'gateway-grant-unavailable',
    );
    expect((await session.receive(call(4, 'other'))).result).toBeDefined();
    expect(previews.map((item) => item.baseline)).toEqual(['none', 'none']);
    expect(effects()).toHaveLength(1);
  });

  it('fails closed on a spent matching ID after restart until the owner selects a manifest without it', async () => {
    await ready();
    expect((await session.receive(call(2, 'other'))).result).toBeDefined();
    session.close();
    expect(await session.finish()).toBe(true);
    await ready();
    expect((await session.receive(call(2, 'other'))).error).toBeDefined();
    expect(review).toHaveBeenCalledTimes(1);
    expect(effects()).toHaveLength(1);
    expect(await session.finish()).toBe(true);
    const retainedId = manifest.grants[2].id;
    manifest.grants.splice(1, 1);
    expect(manifest.grants[1].id).toBe(retainedId);
    await ready();
    expect((await session.receive(call(2, 'other'))).result).toBeDefined();
    expect(review).toHaveBeenCalledTimes(2);
    expect(previews.map((preview) => preview.baseline)).toEqual(['none', 'none']);
    expect(effects()).toHaveLength(2);
  });

  it('does not replay a consumed grant after an effect with a lost response', async () => {
    const config = JSON.parse(fs.readFileSync(paths.config, 'utf8'));
    save(paths.config, { ...config, mode: 'hang' });
    await ready();
    let returned = false;
    const first = session.receive(call(2, 'chosen')).then((value) => {
      returned = true;
      return value;
    });
    await vi.waitFor(() => expect(effects()).toHaveLength(1), { timeout: 8000 });
    expect(returned).toBe(false);
    expect(review).toHaveBeenCalledTimes(1);
    const receipt = createHash('sha256').update(manifest.grants[0].id).digest('hex') + '.used';
    expect(fs.existsSync(path.join(paths.store, receipt))).toBe(true);
    session.close();
    expect((await first).error).toBeDefined();
    expect(await session.finish()).toBe(true);

    // A new gateway session cannot reuse the same durable ID for this call.
    await ready();
    expect((await session.receive(call(2, 'chosen'))).error.message).toBe('gateway-call-failed');
    expect(review).toHaveBeenCalledTimes(1);
    expect(effects()).toHaveLength(1);
    expect(await session.finish()).toBe(true);

    // The operator selects a fresh grant. This fixture does not deduplicate calls.
    const oldGrant = manifest.grants.shift();
    manifest.grants.unshift({ ...oldGrant, id: '4'.repeat(32) });
    save(paths.config, { ...config, mode: 'normal' });
    await ready();
    let resolveApproval = () => {};
    review.mockImplementationOnce(() => new Promise((resolve) => (resolveApproval = resolve)));
    const second = session.receive(call(2, 'chosen'));
    try {
      await vi.waitFor(() => expect(review).toHaveBeenCalledTimes(2), { timeout: 8000 });
      expect(effects()).toHaveLength(1);
      resolveApproval(true);
      expect((await second).result.structuredContent).toEqual({ accepted: true });
    } finally {
      resolveApproval(false);
      session.close();
      await second;
    }
    expect(effects()).toEqual([
      { name: 'record', arguments: { recipient: 'chosen' } },
      { name: 'record', arguments: { recipient: 'chosen' } },
    ]);
  }, 30000);

  it('closes on matching cancellation and discards a late approval without upstream dispatch', async () => {
    let resolveReview;
    review.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReview = resolve;
        }),
    );
    await ready();
    const running = session.receive(call(2, 'chosen'));
    await vi.waitFor(() => expect(resolveReview).toBeTypeOf('function'));
    await session.receive({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 2 },
    });
    resolveReview(true);
    expect((await running).error).toBeDefined();
    expect(effects()).toEqual([]);
  });

  it('rejects a review that exceeds its monotonic deadline even before its timer runs', async () => {
    const now = performance.now.bind(performance);
    review.mockImplementation(async () => {
      vi.spyOn(performance, 'now').mockReturnValue(now() + 66000);
      return true;
    });
    await ready();
    try {
      expect((await session.receive(call(2, 'chosen'))).error).toBeDefined();
      expect(effects()).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('rejects an expired grant after owner confirmation before any upstream effect', async () => {
    const realNow = Date.now;
    review.mockImplementation(async () => {
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 180000);
      return true;
    });
    await ready();
    try {
      expect((await session.receive(call(2, 'chosen'))).error).toBeDefined();
      expect(effects()).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('reviews and forwards the captured request when its caller later mutates the original', async () => {
    let complete;
    review.mockImplementation((preview) => {
      previews.push(JSON.parse(preview));
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    await ready();
    const request = call(2, 'chosen');
    const running = session.receive(request);
    request.params.arguments.recipient = 'outside-scope';
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    complete(true);
    expect((await running).result).toBeDefined();
    expect(previews[0].current).toEqual({ recipient: 'chosen' });
    expect(effects()).toEqual([{ name: 'record', arguments: { recipient: 'chosen' } }]);
  });

  it.each(['manifest', 'disclosure', 'secrets'])(
    'refuses changed %s after owner review',
    async (changed) => {
      review.mockImplementation(async () => {
        fs.appendFileSync(paths[changed], ' ');
        return true;
      });
      await ready();
      expect((await session.receive(call(2, 'chosen'))).error).toBeDefined();
      expect(effects()).toEqual([]);
    },
  );

  it('refuses selected known-secret content before any owner preview or upstream effect', async () => {
    manifest.grants[0].arguments.recipient = 'Synthetic_Secret_847';
    await ready();
    const response = await session.receive(call(2, 'Synthetic_Secret_847'));
    expect(response.error).toBeDefined();
    expect(JSON.stringify(response)).not.toContain('Synthetic_Secret_847');
    expect(review).not.toHaveBeenCalled();
    expect(effects()).toEqual([]);
  });

  it('refuses an unlisted leaf before any owner preview or upstream effect', async () => {
    save(paths.disclosure, { schemaVersion: 1, tools: [{ name: 'record', paths: ['/other'] }] });
    await ready();
    expect((await session.receive(call(2, 'chosen'))).error).toBeDefined();
    expect(review).not.toHaveBeenCalled();
    expect(effects()).toEqual([]);
  });

  it('keeps the ordinary gateway duplicate-grant contract unchanged', async () => {
    save(paths.manifest, manifest);
    session = createMcpGateway({
      policyPath: paths.policy,
      requestPath: paths.request,
      manifestPath: paths.manifest,
      grantStorePath: paths.store,
      secretPolicyPath: paths.secrets,
      onFailure: failed,
    });
    expect((await session.receive(init())).error).toBeDefined();
    expect(fs.existsSync(paths.started)).toBe(false);
  });
});
