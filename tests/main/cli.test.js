import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const cli = require('../../src/main/cli.js');

describe('cli', () => {
  let output;

  beforeEach(() => {
    output = [];
    cli._setDepsForTest({ writeFn: (str) => output.push(str) });
  });

  afterEach(() => {
    cli._resetForTest();
  });

  it('returns null with no arguments (GUI mode)', async () => {
    const result = await cli.handleCLI([]);
    expect(result).toBeNull();
    expect(output).toEqual([]);
  });

  it('--version prints version from package.json', async () => {
    const pkg = require('../../package.json');
    const result = await cli.handleCLI(['--version']);
    expect(result).toBe(0);
    expect(output).toEqual([pkg.version]);
  });

  it('--help prints usage text', async () => {
    const result = await cli.handleCLI(['--help']);
    expect(result).toBe(0);
    expect(output[0]).toContain('AEGIS');
    expect(output[0]).toContain('--scan-json');
    expect(output[0]).toContain('--version');
    expect(output[0]).toContain('--help');
  });

  it('--scan-json calls scan and outputs JSON', async () => {
    const fakeData = { agents: [{ agent: 'Test', pid: 1 }], localModels: {} };
    cli._setDepsForTest({
      writeFn: (str) => output.push(str),
      scanFn: async () => fakeData,
    });
    const result = await cli.handleCLI(['--scan-json']);
    expect(result).toBe(0);
    const parsed = JSON.parse(output[0]);
    expect(parsed.agents).toEqual(fakeData.agents);
  });

  it('unknown flag shows help and returns exit code 1', async () => {
    const result = await cli.handleCLI(['--bogus']);
    expect(result).toBe(1);
    expect(output[0]).toContain('Unknown option: --bogus');
    expect(output[1]).toContain('--help');
  });

  it('--scan-json output is valid JSON with expected shape', async () => {
    cli._setDepsForTest({
      writeFn: (str) => output.push(str),
      scanFn: async () => ({
        timestamp: '2026-01-01T00:00:00Z',
        agents: [],
        localModels: { ollama: { running: false, models: [] }, lmstudio: { running: false, models: [] } },
      }),
    });
    const result = await cli.handleCLI(['--scan-json']);
    expect(result).toBe(0);
    const parsed = JSON.parse(output[0]);
    expect(parsed).toHaveProperty('timestamp');
    expect(parsed).toHaveProperty('agents');
    expect(parsed).toHaveProperty('localModels');
    expect(parsed.localModels).toHaveProperty('ollama');
    expect(parsed.localModels).toHaveProperty('lmstudio');
  });
});
