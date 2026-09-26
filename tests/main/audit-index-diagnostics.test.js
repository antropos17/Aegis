import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

const require_ = createRequire(import.meta.url);
const index = require_('../../src/main/audit-index.js');
const rebuild = require_('../../src/main/audit-index-rebuild.js');
const logger = require_('../../src/main/logger.js');
const auditLogger = require_('../../src/main/audit-logger.js');

describe('audit index diagnostics', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-index-diagnostics-'));
  });

  afterEach(() => {
    auditLogger.shutdown();
    index.close();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('publishes a fixed status code when opening the projection fails', () => {
    const state = index.open({
      userDataPath: root,
      loadSqlite: () => ({
        DatabaseSync: class {
          constructor() {
            throw new Error('PRIVATE_OPEN_CANARY');
          }
        },
      }),
    });

    expect(state).toBe('failed');
    expect(index.status().lastError).toBe('index-open-failed');
    expect(JSON.stringify(index.status())).not.toContain('PRIVATE_OPEN_CANARY');
  });

  it('does not log the audit directory or exception when rebuilding fails', async () => {
    expect(index.open({ userDataPath: root })).toBe('building');
    const failure = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const privateDir = path.join(root, 'PRIVATE_AUDIT_DIR_CANARY');

    await rebuild.schedule(privateDir);

    expect(failure).toHaveBeenCalledWith('audit-index', 'rebuild failed', {
      code: 'index-rebuild-failed',
    });
    expect(index.status().lastError).toBe('index-rebuild-failed');
    expect(JSON.stringify(failure.mock.calls)).not.toContain('PRIVATE_AUDIT_DIR_CANARY');
  });

  it('does not print a private path when the post-flush index stat fails', async () => {
    auditLogger.init({ userDataPath: root });
    await auditLogger._awaitIndexForTest();
    auditLogger.log('file-access', { agent: 'fixture', path: '/private/example' });
    auditLogger.flush();

    const realStat = fs.statSync;
    const stat = vi.spyOn(fs, 'statSync').mockImplementation((file, ...args) => {
      if (String(file).includes('aegis-audit-')) throw new Error('PRIVATE_INDEX_STAT_CANARY');
      return realStat(file, ...args);
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      auditLogger.log('file-access', { agent: 'fixture', path: '/private/second' });
      auditLogger.flush();
    } finally {
      stat.mockRestore();
    }

    expect(error).toHaveBeenCalledWith('[audit-logger] index append failed');
    expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE_INDEX_STAT_CANARY');
    expect(index.status().state).toBe('failed');
  });
});
