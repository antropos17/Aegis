import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '../..');
const entry = path.join(project, 'scripts/qualification/qualify-native-bootstrap.mjs');

describe('native bootstrap CLI refusal before compilation', () => {
  let root, existing, fresh;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-bootstrap-cli-'));
    existing = path.join(root, 'existing.json');
    fresh = path.join(root, 'fresh.json');
    fs.writeFileSync(existing, 'preserved receipt\n', { flag: 'wx' });
  });
  afterAll(() => {
    expect(fs.realpathSync(root)).toBe(root);
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    expect(fs.readdirSync(root)).toEqual(['existing.json']);
    fs.unlinkSync(existing);
    fs.rmdirSync(root);
  });
  it.each([
    ['missing', () => []],
    ['relative', () => ['--receipt', 'relative-receipt.json']],
    ['existing', () => ['--receipt', existing]],
    ['extension', () => ['--receipt', path.join(root, 'fresh.txt')]],
    ['VM selector', () => ['--receipt', fresh, '--vm-id', '11111111-2222-4333-8444-555555555555']],
    ['command', () => ['--receipt', fresh, '--mode', 'admit; arbitrary command']],
    ['duplicate', () => ['--receipt', fresh, '--mode', 'admit', '--mode', 'cancel']],
  ])('refuses %s and preserves receipts without producing compiler scratch', (_, args) => {
    const result = spawnSync(process.execPath, [entry, ...args()], {
      cwd: root,
      env: { ...process.env, TEMP: root, TMP: root },
      shell: false,
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 4096,
      encoding: 'utf8',
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('native-bootstrap-unavailable\n');
    expect(fs.readFileSync(existing, 'utf8')).toBe('preserved receipt\n');
    expect(fs.readdirSync(root)).toEqual(['existing.json']);
  });
});
