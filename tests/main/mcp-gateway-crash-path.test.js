import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  selectFixture,
  createFixture,
  verifyWindowsParent,
} = require('../fixtures/mcp-crash-custody/owned-path.cjs');
const settings = (temp, env, verifyParent = () => true) => ({
  env,
  temp,
  platform: 'win32',
  arch: 'x64',
  verifyParent,
});

it('does not request a fixture when neither explicit option is present', () => {
  expect(selectFixture(settings(os.tmpdir(), {}))).toBeNull();
});

it('refuses malformed, unsupported and outside-parent opt-ins before creating anything', () => {
  const temp = path.resolve(os.tmpdir());
  const root = path.join(temp, 'aegis-mcp-crash-Test01');
  for (const env of [
    { AEGIS_MCP_CRASH_FIXTURE: '0', AEGIS_MCP_CRASH_ROOT: root },
    { AEGIS_MCP_CRASH_FIXTURE: '1' },
    { AEGIS_MCP_CRASH_ROOT: root },
    { AEGIS_MCP_CRASH_FIXTURE: '1', AEGIS_MCP_CRASH_ROOT: 'relative' },
    {
      AEGIS_MCP_CRASH_FIXTURE: '1',
      AEGIS_MCP_CRASH_ROOT: path.join(temp, 'sub', 'aegis-mcp-crash-Test01'),
    },
    { AEGIS_MCP_CRASH_FIXTURE: '1', AEGIS_MCP_CRASH_ROOT: path.join(temp, 'unrelated') },
  ])
    expect(() => selectFixture(settings(temp, env))).toThrow('fixture-selection-invalid');
  const input = { AEGIS_MCP_CRASH_FIXTURE: '1', AEGIS_MCP_CRASH_ROOT: root };
  expect(() => selectFixture({ ...settings(temp, input), platform: 'linux' })).toThrow(
    'fixture-selection-invalid',
  );
  expect(() => selectFixture({ ...settings(temp, input), arch: 'arm64' })).toThrow(
    'fixture-selection-invalid',
  );
  expect(() => selectFixture(settings(temp, input, () => false))).toThrow(
    'fixture-parent-unavailable',
  );
});

it('creates only a selected new direct child and refuses overwriting it', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-path-check-'));
  const target = path.join(temp, 'aegis-mcp-crash-Test01');
  const verify = vi.fn(() => true);
  try {
    expect(
      selectFixture(
        settings(temp, { AEGIS_MCP_CRASH_FIXTURE: '1', AEGIS_MCP_CRASH_ROOT: target }, verify),
      ),
    ).toBe(target);
    expect(verify).toHaveBeenCalledOnce();
    createFixture(target);
    expect(() => createFixture(target)).toThrow();
  } finally {
    if (fs.existsSync(target)) fs.rmdirSync(target);
    fs.rmdirSync(temp);
  }
});

it.skipIf(process.platform !== 'win32')(
  'checks the selected native TEMP ancestors without a PowerShell profile',
  () => {
    expect(verifyWindowsParent(path.resolve(os.tmpdir()), process.env)).toBe(true);
  },
);
