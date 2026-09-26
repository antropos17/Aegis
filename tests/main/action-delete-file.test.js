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
