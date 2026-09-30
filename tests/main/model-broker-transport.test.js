import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import dns from 'node:dns';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createModelFixture, OUTPUT } from '../../scripts/qualification/model-broker-fixture.mjs';
import { createModelOwner } from './fixtures/model-broker-owner.mjs';
const fixtures = [],
  owners = [];
const make = async (secure = true) => {
  const fixture = await createModelFixture({ secure });
  fixtures.push(fixture);
  const owner = await createModelOwner(fixture);
  owners.push(owner);
  return { fixture, ...owner };
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const owner of owners) owner.close();
  owners.length = 0;
  for (const fixture of fixtures) await fixture.close();
  fixtures.length = 0;
});
const execute = (owner) => {
  const a = owner.prepare();
  return owner.broker.request(a.capability, a.prepared);
};

it('uses pinned HTTPS without invoking ambient DNS', async () => {
  const owner = await make();
  const lookup = vi.spyOn(dns, 'lookup').mockImplementation(() => {
    throw Error('forbidden DNS');
  });
  expect(await execute(owner)).toMatchObject({ state: 'completed', text: OUTPUT });
  expect(lookup).not.toHaveBeenCalled();
  expect(owner.fixture.state.authorized).toBe(1);
});

it.each(['wrong-name', 'expired', 'untrusted', 'rotated'])(
  'refuses changed %s TLS before delivering credentials',
  async (certificate) => {
    const owner = await make();
    await owner.fixture.replaceCertificate(certificate);
    expect(await execute(owner)).toEqual({
      schemaVersion: 1,
      state: 'outcome-unknown',
      launchAllowed: false,
    });
    expect(owner.fixture.state.connections).toBeGreaterThan(0);
    expect(owner.fixture.state.deliveries).toBe(0);
  },
);

it('checks the literal loopback restriction before connecting', async () => {
  const fixture = await createModelFixture({ secure: true });
  fixtures.push(fixture);
  await fs.writeFile(
    fixture.endpointPath,
    JSON.stringify({ ...fixture.descriptor, connectAddress: '127.0.0.2' }),
  );
  await expect(createModelOwner(fixture)).rejects.toThrow('model-owner-unavailable');
  expect(fixture.state.connections).toBe(0);
});

it('does not follow a redirect to a second independent receiver', async () => {
  const a = await make(false),
    b = await createModelFixture();
  fixtures.push(b);
  a.fixture.state.mode = 'redirect';
  a.fixture.state.redirect = b.descriptor.url;
  expect((await execute(a)).state).toBe('outcome-unknown');
  expect(a.fixture.state.deliveries).toBe(1);
  expect(b.state.connections).toBe(0);
});

async function childProbe(fixture, extra = {}, flags = []) {
  const child = spawn(
    process.execPath,
    [
      ...flags,
      fileURLToPath(new URL('./fixtures/model-broker-client.mjs', import.meta.url)),
      fixture.endpointPath,
      fixture.ledgerPath,
    ],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extra },
    },
  );
  let output = '',
    errors = '',
    overflow = false;
  for (const [stream, add] of [
    [
      child.stdout,
      (s) => {
        output += s;
      },
    ],
    [
      child.stderr,
      (s) => {
        errors += s;
      },
    ],
  ])
    stream.on('data', (bytes) => {
      if (output.length + errors.length + bytes.length > 65536) {
        overflow = true;
        child.kill();
      } else add(bytes.toString());
    });
  const timer = setTimeout(() => child.kill(), 7000);
  const [code] = await once(child, 'close');
  clearTimeout(timer);
  expect(overflow).toBe(false);
  expect(code).toBe(0);
  expect(output + errors).not.toContain(fixture.token);
  expect(output + errors).not.toContain('BEGIN CERTIFICATE');
  expect(output + errors).not.toContain('mcp.fixture.test');
  return { result: JSON.parse(output), errors };
}

it.each(['debug', 'trace', 'keylog'])(
  'refuses %s diagnostics before connecting without private diagnostics',
  async (mode) => {
    const fixture = await createModelFixture({ secure: true });
    fixtures.push(fixture);
    const extra =
      mode === 'debug'
        ? { NODE_DEBUG: 'http' }
        : mode === 'keylog'
          ? {
              NODE_OPTIONS:
                (process.env.NODE_OPTIONS || '') + ' --tls-keylog=' + fixture.root + '/keylog',
            }
          : {};
    const result = await childProbe(fixture, extra, mode === 'trace' ? ['--trace-tls'] : []);
    expect(result.result).toEqual({ state: 'refused', hasText: false });
    expect(fixture.state.connections).toBe(0);
    if (mode === 'keylog')
      await expect(fs.stat(fixture.root + '/keylog')).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it.each([false, true])(
  'bypasses an actually enabled ambient proxy for secure=%s',
  async (secure) => {
    const fixture = await createModelFixture({ secure });
    fixtures.push(fixture);
    let proxyConnections = 0;
    const proxy = http.createServer((_req, response) => response.writeHead(502).end());
    proxy.on('connection', () => {
      proxyConnections++;
    });
    proxy.on('connect', (_req, socket) => socket.destroy());
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const url = `http://127.0.0.1:${proxy.address().port}`;
    const env = {
      NODE_USE_ENV_PROXY: '1',
      HTTP_PROXY: url,
      HTTPS_PROXY: url,
      http_proxy: url,
      https_proxy: url,
      NO_PROXY: '',
      no_proxy: '',
    };
    try {
      const control = spawn(
        process.execPath,
        [
          '-e',
          "require('node:http').get('http://127.0.0.1:65530/model',r=>r.resume()).on('error',()=>{})",
        ],
        { windowsHide: true, env: { ...process.env, ...env }, stdio: 'ignore' },
      );
      expect((await once(control, 'close'))[0]).toBe(0);
      expect(proxyConnections).toBeGreaterThan(0);
      const before = proxyConnections;
      expect((await childProbe(fixture, env)).result).toEqual({
        state: 'completed',
        hasText: true,
      });
      expect(proxyConnections).toBe(before);
      expect(fixture.state.authorized).toBe(1);
    } finally {
      await new Promise((resolve) => proxy.close(resolve));
    }
  },
  10000,
);
