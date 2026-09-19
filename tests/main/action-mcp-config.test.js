import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import cp from 'node:child_process';

const require = createRequire(import.meta.url);
const api = require('../../src/main/action-mcp-config');
const runtime = (platform = 'win32', extra = {}) =>
  api._setDepsForTest({
    platform,
    execPath: platform === 'win32' ? 'C:\\Program Files\\node.exe' : '/usr/bin/node',
    mainPath: platform === 'win32' ? 'X:\\AEGIS\\src\\main\\main.js' : '/opt/AEGIS/main.js',
    ...extra,
  });
afterEach(() => {
  api._resetForTest();
  vi.restoreAllMocks();
});
function cli(mode, paths = []) {
  const write = vi.fn();
  const code = api.handleActionMcpConfigCLI(['--action-mcp-config-json', mode, ...paths], write);
  expect(write).toHaveBeenCalledTimes(1);
  return { code, value: JSON.parse(write.mock.calls[0][0]) };
}

it.each([
  ['selected', ['X:/private/policy.json', 'X:/private/request.json'], '--action-mcp-stdio'],
  ['catalog', ['X:/private/catalog.json'], '--action-mcp-catalog-stdio'],
  ['relay', ['X:/not-created/endpoint.json'], '--action-mcp-connect'],
])('generates only the fixed %s entry and literal path arguments', (mode, paths, flag) => {
  runtime();
  expect(cli(mode, paths)).toEqual({
    code: 0,
    value: {
      mcpServers: {
        aegis: {
          type: 'stdio',
          command: 'C:\\Program Files\\node.exe',
          args: ['X:\\AEGIS\\src\\main\\main.js', flag, ...paths],
        },
      },
    },
  });
});

it('uses the current Node executable and repository main entry without a test seam', () => {
  const selected =
    process.platform === 'win32' ? 'X:/selected/catalog.json' : '/selected/catalog.json';
  const config = api.buildActionMcpConfig('catalog', [selected]);
  expect(config.mcpServers.aegis.command).toBe(process.execPath);
  expect(config.mcpServers.aegis.args[0]).toBe(require.resolve('../../src/main/main.js'));
});

it.each(['X:/space name/тест/../link/catalog.json', 'X:\\literal\\a&b;$(command)`".json'])(
  'preserves literal spaces, Unicode, parent traversal and metacharacters %#',
  (selected) => {
    runtime();
    const result = cli('catalog', [selected]);
    expect(result.code).toBe(0);
    expect(result.value.mcpServers.aegis.args[2]).toBe(selected);
  },
);

it.each([
  'relative.json',
  'X:relative.json',
  '\\root-relative.json',
  '/root-relative.json',
  '\\\\server\\share\\file',
  '//server/share/file',
  'X:/file:stream',
  'X:/foo\nbar',
  'X:/foo\0bar',
  'X:/foo\u007fbar',
  '',
  'X:/' + 'a'.repeat(4094),
])('rejects ambiguous, nonlocal, controlled or oversized Windows paths %#', (value) => {
  runtime();
  expect(cli('catalog', [value])).toEqual({
    code: 1,
    value: { error: 'expected-action-mcp-config-arguments' },
  });
});

it('counts UTF-8 bytes and accepts the exact limit', () => {
  runtime('linux');
  expect(cli('relay', ['/' + 'a'.repeat(4095)]).code).toBe(0);
  expect(cli('relay', ['/' + 'é'.repeat(2048)]).code).toBe(1);
  expect(cli('relay', ['/tmp/name:colon']).code).toBe(0);
  expect(cli('relay', ['//remote/file']).code).toBe(1);
});

it.each([
  ['unknown', ['X:/one']],
  ['selected', ['X:/one']],
  ['selected', ['X:/one', 'X:/two', 'X:/three']],
  ['catalog', []],
  ['relay', ['X:/one', 'X:/two']],
  ['__proto__', ['X:/one']],
])('rejects unsupported mode or arity %#', (mode, paths) => {
  runtime();
  expect(cli(mode, paths).code).toBe(1);
});

it('rejects sparse arrays and non-string paths', () => {
  runtime();
  expect(() => api.buildActionMcpConfig('selected', Array(2))).toThrow(
    'expected-action-mcp-config-arguments',
  );
  expect(() => api.buildActionMcpConfig('catalog', [42])).toThrow(
    'expected-action-mcp-config-arguments',
  );
  const write = vi.fn();
  expect(api.handleActionMcpConfigCLI(['--wrong', 'relay', 'X:/one'], write)).toBe(1);
});

it.each([
  { electron: '40.0.0' },
  { execPath: 'node' },
  { mainPath: 'relative.js' },
  { execPath: 'X:/' + 'a'.repeat(4096) },
  { mainPath: 'X:/main.js:stream' },
])('rejects unsupported trusted runtime metadata %# with a fixed error', (extra) => {
  runtime('win32', extra);
  expect(cli('relay', ['X:/endpoint.json'])).toEqual({
    code: 2,
    value: { error: 'action-mcp-config-unavailable' },
  });
});

it('does not echo an unexpected runtime exception', () => {
  api._setDepsForTest({
    platform: 'win32',
    get execPath() {
      throw Error('PRIVATE_EXCEPTION');
    },
  });
  expect(cli('relay', ['X:/endpoint.json'])).toEqual({
    code: 2,
    value: { error: 'action-mcp-config-unavailable' },
  });
});

it('does not read files, perform preflight, copy environment, write files, connect or spawn', () => {
  runtime();
  const fail = vi.fn(() => {
    throw Error('unexpected-io');
  });
  for (const name of [
    'readFileSync',
    'writeFileSync',
    'statSync',
    'lstatSync',
    'realpathSync',
    'openSync',
  ])
    vi.spyOn(fs, name).mockImplementation(fail);
  for (const name of ['spawn', 'spawnSync', 'exec', 'execFile'])
    vi.spyOn(cp, name).mockImplementation(fail);
  vi.spyOn(net, 'connect').mockImplementation(fail);
  vi.spyOn(net.Server.prototype, 'listen').mockImplementation(fail);
  const result = cli('relay', ['X:/not-yet-created/endpoint.json']);
  expect(result.code).toBe(0);
  expect(fail).not.toHaveBeenCalled();
  expect(Object.keys(result.value.mcpServers.aegis)).toEqual(['type', 'command', 'args']);
  expect(JSON.stringify(result.value)).not.toMatch(/token|env|approval|authorization/);
});
