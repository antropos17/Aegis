import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('platform/index', () => {
  it('exports the correct platform module for the current OS', () => {
    const platform = require('../../../src/main/platform/index.js');

    // On whatever OS we're running, the module should export the expected interface
    expect(typeof platform.listProcesses).toBe('function');
    expect(typeof platform.getParentProcessMap).toBe('function');
    expect(typeof platform.getRawTcpConnections).toBe('function');
    expect(typeof platform.getFileHandles).toBe('function');
    expect(typeof platform.getProcessCwd).toBe('function');
    expect(typeof platform.killProcess).toBe('function');
    expect(typeof platform.suspendProcess).toBe('function');
    expect(typeof platform.resumeProcess).toBe('function');
    expect(Array.isArray(platform.IGNORE_FILE_PATTERNS)).toBe(true);
  });

  it('selects darwin module on macOS', () => {
    // This test validates the current platform's module is loaded
    // On macOS CI/local, this confirms darwin was selected
    if (process.platform === 'darwin') {
      const platform = require('../../../src/main/platform/index.js');
      const darwin = require('../../../src/main/platform/darwin.js');
      expect(platform.listProcesses).toBe(darwin.listProcesses);
    }
  });

  it('selects linux module on Linux', () => {
    if (process.platform === 'linux') {
      const platform = require('../../../src/main/platform/index.js');
      const linux = require('../../../src/main/platform/linux.js');
      expect(platform.listProcesses).toBe(linux.listProcesses);
    }
  });
});
