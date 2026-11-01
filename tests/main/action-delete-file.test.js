import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const terminal = require('../../src/main/action-confirmation-terminal');
const api = require('../../src/main/action-delete-file');
let root, policyPath, requestPath, target, operation;

function writeConfig(decision = 'allow') {
  fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, operation }));
  fs.writeFileSync(
    policyPath,
    JSON.stringify({
      schemaVersion: 1,
      defaultDecision: 'deny',
      rules: [{ operation, decision }],
    }),
  );
}

function review(confirm = async () => true) {
  vi.spyOn(terminal, 'isTerminalAvailable').mockReturnValue(true);
  vi.spyOn(terminal, 'watchTerminalLifetime').mockReturnValue(() => {});
  vi.spyOn(terminal, 'monitorTerminalInput').mockReturnValue(() => {});
  vi.spyOn(terminal, 'confirmInTerminal').mockImplementation(confirm);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-delete-file-'));
  policyPath = path.join(root, 'private-policy.json');
  requestPath = path.join(root, 'private-request.json');
  target = path.join(root, 'private-target.txt');
  operation = { kind: 'delete-file', path: target };
  fs.writeFileSync(target, 'private contents');
  writeConfig();
  review();
});

afterEach(() => {
  vi.restoreAllMocks();
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('selected structured file deletion', () => {
  // Exercise the legacy path-based branch separately from Windows native orchestration.
  beforeEach(() => api._setDeleteDepsForTest({ platform: 'linux' }));
  afterEach(() => api._resetDeleteDepsForTest());

  it('removes only the exact reviewed ordinary file and redacts the report', async () => {
    const neighbor = path.join(root, 'neighbor.txt');
    fs.writeFileSync(neighbor, 'keep');
    const report = await api.deleteSelectedFile(policyPath, requestPath);
    expect(report).toMatchObject({
      decision: 'allow',
      reason: 'file-deleted',
      operation: { state: 'deleted' },
    });
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(neighbor, 'utf8')).toBe('keep');
    expect(JSON.stringify(report)).not.toContain(root);
    expect(terminal.confirmInTerminal).toHaveBeenCalledWith(operation, {
      signal: expect.any(AbortSignal),
      kind: 'delete-file',
    });
  });

  it('never deletes on policy denial, missing rule, missing terminal or refused review', async () => {
    for (const change of ['deny', 'missing', 'terminal', 'review']) {
      writeConfig(change === 'deny' ? 'deny' : 'allow');
      if (change === 'missing')
        fs.writeFileSync(
          policyPath,
          JSON.stringify({ schemaVersion: 1, defaultDecision: 'deny', rules: [] }),
        );
      if (change === 'terminal') terminal.isTerminalAvailable.mockReturnValueOnce(false);
      if (change === 'review') terminal.confirmInTerminal.mockResolvedValueOnce(false);
      expect((await api.deleteSelectedFile(policyPath, requestPath)).operation.state).toBe(
        'not-started',
      );
      expect(fs.readFileSync(target, 'utf8')).toBe('private contents');
    }
  });

  it('rejects mutation of either selected file during review', async () => {
    for (const changed of [policyPath, requestPath]) {
      writeConfig();
      terminal.confirmInTerminal.mockImplementationOnce(async () => {
        fs.appendFileSync(changed, ' ');
        return true;
      });
      expect((await api.deleteSelectedFile(policyPath, requestPath)).operation.state).toBe(
        'not-started',
      );
      expect(fs.existsSync(target)).toBe(true);
    }
  });

  it('rejects target replacement or content change during review', async () => {
    terminal.confirmInTerminal.mockImplementationOnce(async () => {
      fs.writeFileSync(target, 'changed contents');
      return true;
    });
    expect((await api.deleteSelectedFile(policyPath, requestPath)).reason).toBe('target-changed');
    expect(fs.readFileSync(target, 'utf8')).toBe('changed contents');
  });

  it('rejects a symlink target and a symlink parent', async () => {
    const link = path.join(root, 'link.txt');
    fs.symlinkSync(target, link, 'file');
    operation = { kind: 'delete-file', path: link };
    writeConfig();
    expect((await api.deleteSelectedFile(policyPath, requestPath)).operation.state).toBe(
      'not-started',
    );
    expect(fs.existsSync(target)).toBe(true);
    const parent = path.join(root, 'linked-parent');
    const subdir = path.join(root, 'actual-parent');
    fs.mkdirSync(subdir);
    fs.symlinkSync(subdir, parent, 'junction');
    operation = { kind: 'delete-file', path: path.join(parent, 'file.txt') };
    fs.writeFileSync(path.join(subdir, 'file.txt'), 'keep');
    writeConfig();
    expect((await api.deleteSelectedFile(policyPath, requestPath)).operation.state).toBe(
      'not-started',
    );
    expect(fs.readFileSync(path.join(subdir, 'file.txt'), 'utf8')).toBe('keep');
  });

  it('rejects invalid paths, schema additions and duplicate rules', async () => {
    for (const filename of [
      path.join(root, '..', 'other'),
      target + path.sep + '..',
      process.platform === 'win32' ? target + ':stream' : 'relative.txt',
    ]) {
      operation = { kind: 'delete-file', path: filename };
      writeConfig();
      expect((await api.deleteSelectedFile(policyPath, requestPath)).operation.state).toBe(
        'not-started',
      );
    }
    operation = { kind: 'delete-file', path: target };
    writeConfig();
    fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, operation, extra: true }));
    expect((await api.deleteSelectedFile(policyPath, requestPath)).operation.state).toBe(
      'not-started',
    );
    writeConfig();
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        schemaVersion: 1,
        defaultDecision: 'deny',
        rules: [
          { operation, decision: 'allow' },
          { operation, decision: 'deny' },
        ],
      }),
    );
    expect((await api.deleteSelectedFile(policyPath, requestPath)).operation.state).toBe(
      'not-started',
    );
    expect(fs.existsSync(target)).toBe(true);
  });

  it('rejects pre-abort and wrong CLI invocation without deletion', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      (await api.deleteSelectedFile(policyPath, requestPath, { signal: controller.signal })).reason,
    ).toBe('action-cancelled');
    const reports = [];
    expect(
      await api.handleDeleteFileCLI(['--action-delete-file-confirm'], (value) =>
        reports.push(value),
      ),
    ).toBe(1);
    expect(fs.existsSync(target)).toBe(true);
    expect(reports).toHaveLength(1);
  });
});

describe('Windows selected-file native session', () => {
  let events, session, openWindowsDelete, unlink;

  beforeEach(() => {
    events = [];
    session = {
      commit: vi.fn(async () => {
        events.push('commit');
        // Stand in for a native handle disposition without invoking path unlink.
        fs.renameSync(target, path.join(root, 'native-removed.txt'));
        return 'deleted';
      }),
      close: vi.fn(async () => {
        events.push('close');
        return true;
      }),
    };
    openWindowsDelete = vi.fn(async (selectedTarget) => {
      events.push('open');
      expect(selectedTarget).toBe(target);
      return session;
    });
    api._setDeleteDepsForTest({ platform: 'win32', openWindowsDelete });
    unlink = vi.spyOn(fs.promises, 'unlink');
    terminal.confirmInTerminal.mockImplementation(async () => {
      events.push('confirm');
      return true;
    });
  });

  afterEach(() => {
    api._resetDeleteDepsForTest();
  });

  it('opens before confirmation, commits only afterward, and never unlinks the path', async () => {
    const report = await api.deleteSelectedFile(policyPath, requestPath);
    expect(events).toEqual(['open', 'confirm', 'commit', 'close']);
    expect(report).toMatchObject({ decision: 'allow', operation: { state: 'deleted' } });
    expect(unlink).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain(root);
  });

  it.each(['policy', 'request', 'target'])(
    'rechecks %s after confirmation before commit',
    async (changed) => {
      terminal.confirmInTerminal.mockImplementationOnce(async () => {
        events.push('confirm');
        fs.appendFileSync(
          changed === 'target' ? target : changed === 'policy' ? policyPath : requestPath,
          ' ',
        );
        return true;
      });
      const report = await api.deleteSelectedFile(policyPath, requestPath);
      expect(report.operation.state).toBe('not-started');
      expect(openWindowsDelete).toHaveBeenCalledOnce();
      expect(session.close).toHaveBeenCalledOnce();
      expect(session.commit).not.toHaveBeenCalled();
      expect(unlink).not.toHaveBeenCalled();
      expect(fs.existsSync(target)).toBe(true);
    },
  );

  it.each(['refused', 'aborted'])('closes without mutation when review is %s', async (kind) => {
    const controller = new AbortController();
    terminal.confirmInTerminal.mockImplementationOnce(async () => {
      events.push('confirm');
      if (kind === 'aborted') controller.abort();
      return kind !== 'refused';
    });
    const report = await api.deleteSelectedFile(policyPath, requestPath, {
      signal: controller.signal,
    });
    expect(report.operation.state).toBe('not-started');
    expect(session.commit).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
    expect(unlink).not.toHaveBeenCalled();
    expect(fs.readFileSync(target, 'utf8')).toBe('private contents');
  });

  it('awaits and closes a late native open after cancellation without asking for review', async () => {
    let release;
    let opened;
    const opening = new Promise((resolve) => {
      opened = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    openWindowsDelete.mockImplementationOnce(async () => {
      opened();
      return pending;
    });
    const controller = new AbortController();
    const action = api.deleteSelectedFile(policyPath, requestPath, { signal: controller.signal });
    await opening;
    controller.abort();
    release(session);
    const report = await action;
    expect(report.operation.state).toBe('not-started');
    expect(terminal.confirmInTerminal).not.toHaveBeenCalled();
    expect(session.commit).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
    expect(unlink).not.toHaveBeenCalled();
    expect(fs.existsSync(target)).toBe(true);
  });

  it.each(['before', 'after'])(
    'interrupts a pending control identity check %s review on cancellation',
    async (phase) => {
      let entered;
      let release;
      const checking = new Promise((resolve) => {
        entered = resolve;
      });
      const pending = new Promise((resolve) => {
        release = resolve;
      });
      const stat = fs.promises.stat.bind(fs.promises);
      let checks = 0;
      vi.spyOn(fs.promises, 'stat').mockImplementation(async (filename, options) => {
        if (filename === policyPath && ++checks === (phase === 'before' ? 1 : 2)) {
          entered();
          return pending;
        }
        return stat(filename, options);
      });
      const controller = new AbortController();
      const action = api.deleteSelectedFile(policyPath, requestPath, { signal: controller.signal });
      await checking;
      controller.abort();
      const report = await action;
      expect(report.operation.state).toBe('not-started');
      expect(openWindowsDelete).toHaveBeenCalledOnce();
      expect(terminal.confirmInTerminal).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
      expect(session.commit).not.toHaveBeenCalled();
      expect(session.close).toHaveBeenCalledOnce();
      expect(unlink).not.toHaveBeenCalled();
      expect(fs.existsSync(target)).toBe(true);
      release(await stat(policyPath, { bigint: true }));
    },
  );

  it.each(['unknown', 'throws'])('reports unknown when commit outcome is %s', async (outcome) => {
    session.commit.mockImplementationOnce(async () => {
      if (outcome === 'throws') throw new Error('private native failure');
      return 'unknown';
    });
    const report = await api.deleteSelectedFile(policyPath, requestPath);
    expect(report.operation.state).toBe('unknown');
    expect(session.close).toHaveBeenCalledOnce();
    expect(unlink).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain('private native failure');
  });

  it('reports unknown if helper cleanup is unconfirmed after a deleted commit', async () => {
    session.close.mockResolvedValueOnce(false);
    const report = await api.deleteSelectedFile(policyPath, requestPath);
    expect(report.operation.state).toBe('unknown');
    expect(session.commit).toHaveBeenCalledOnce();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('does not report deletion when the native witness is refused', async () => {
    session.commit.mockResolvedValueOnce('refused');
    const report = await api.deleteSelectedFile(policyPath, requestPath);
    expect(report.operation.state).toBe('not-started');
    expect(session.close).toHaveBeenCalledOnce();
    expect(unlink).not.toHaveBeenCalled();
    expect(fs.existsSync(target)).toBe(true);
  });

  it.skipIf(process.platform !== 'win32').each(['policy', 'request'])(
    'rejects a case-different alias of the selected %s file',
    async (control) => {
      const selected = control === 'policy' ? policyPath : requestPath;
      target = selected.toUpperCase();
      operation = { kind: 'delete-file', path: target };
      writeConfig();
      const report = await api.deleteSelectedFile(policyPath, requestPath);
      expect(report.operation.state).toBe('not-started');
      expect(session.commit).not.toHaveBeenCalled();
      expect(unlink).not.toHaveBeenCalled();
      expect(fs.existsSync(selected)).toBe(true);
    },
  );

  it.each(['policy', 'request'])(
    'rejects a hardlink alias of the selected %s file',
    async (control) => {
      const selected = control === 'policy' ? policyPath : requestPath;
      target = path.join(root, 'hardlink-alias.json');
      operation = { kind: 'delete-file', path: target };
      writeConfig();
      fs.linkSync(selected, target);
      const report = await api.deleteSelectedFile(policyPath, requestPath);
      expect(report.operation.state).toBe('not-started');
      expect(openWindowsDelete).toHaveBeenCalledOnce();
      expect(session.close).toHaveBeenCalledOnce();
      expect(session.commit).not.toHaveBeenCalled();
      expect(unlink).not.toHaveBeenCalled();
      expect(fs.existsSync(selected)).toBe(true);
    },
  );
});
