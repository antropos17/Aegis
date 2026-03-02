import { describe, it, expect } from 'vitest';
import platform from '../../../src/main/platform/index.js';
import darwin from '../../../src/main/platform/darwin.js';
import linux from '../../../src/main/platform/linux.js';

describe('platform/index', () => {
  it('exports the correct platform module for the current OS', () => {
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
      expect(platform.listProcesses).toBe(darwin.listProcesses);
    }
  });

  it('selects linux module on Linux', () => {
    if (process.platform === 'linux') {
      expect(platform.listProcesses).toBe(linux.listProcesses);
    }
  });
});
