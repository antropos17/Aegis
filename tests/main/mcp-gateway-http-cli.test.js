import { afterEach, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { httpFixture } from './fixtures/mcp-http-server';
let fixture, root, child;
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const done = once(child, 'close');
    child.kill('SIGKILL');
    await done;
  }
  child = undefined;
  if (fixture) await fixture.close();
  fixture = undefined;
  if (root) {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
  }
});
it.each(['http', 'net'])(
  'rejects cached Node %s diagnostics before sending private headers',
  async (debug) => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-http-debug-'));
    const schema = { type: 'object', properties: {}, required: [], additionalProperties: false };
    const tool = { name: 'empty', inputSchema: schema, outputSchema: schema };
    fixture = await httpFixture(tool);
    const endpoint = path.join(root, 'endpoint.json'),
      manifest = path.join(root, 'manifest.json');
    fs.writeFileSync(
      endpoint,
      JSON.stringify({ schemaVersion: 1, url: fixture.url, bearerToken: fixture.state.token }),
    );
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        schemaVersion: 1,
        tools: [tool],
        grants: [{ tool: 'empty', arguments: {} }],
      }),
    );
    child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('../../src/main/main.js', import.meta.url)),
        '--mcp-gateway-http',
        endpoint,
        manifest,
      ],
      { windowsHide: true, stdio: 'pipe', env: { ...process.env, NODE_DEBUG: debug } },
    );
    const done = once(child, 'close');
    let output = '';
    child.stdout.on('data', (v) => {
      output += v;
    });
    child.stderr.on('data', (v) => {
      output += v;
    });
    child.stdin.on('error', () => {});
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {} },
      }) + '\n',
    );
    expect((await done)[0]).toBe(2);
    expect(fixture.state.messages).toHaveLength(0);
    expect(output).not.toContain('PRIVATE');
    expect(output).not.toContain(fixture.url);
  },
);
