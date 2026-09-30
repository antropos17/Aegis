import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '../..');
const entry = path.join(project, 'scripts/qualification/qualify-guest-channel.mjs');
describe('guest channel CLI refusal', () => {
  let root, fresh, preserved;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-guest-cli-'));
    fresh = path.join(root, 'fresh.json');
    preserved = path.join(root, 'preserved.json');
    fs.writeFileSync(preserved, 'preserved\n', { flag: 'wx' });
  });
  afterAll(() => {
    expect(fs.realpathSync(root)).toBe(root);
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    expect(fs.readdirSync(root)).toEqual(['preserved.json']);
    fs.unlinkSync(preserved);
    fs.rmdirSync(root);
  });
  it.each([
    () => [],
    () => ['--receipt', 'relative.json'],
    () => ['--receipt', preserved],
    () => ['--receipt', path.join(root, 'fresh.txt')],
    () => ['--receipt', fresh, '--vm-id', '11111111-2222-4333-8444-555555555555'],
    () => ['--receipt', fresh, '--mode', 'admit; arbitrary command'],
    () => ['--receipt', fresh, '--mode', 'admit', '--mode', 'cancel'],
  ])('rejects unsafe argument vector without compilation or overwrite', (args) => {
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
    expect(result.stderr).toBe('guest-channel-unavailable\n');
    expect(fs.readFileSync(preserved, 'utf8')).toBe('preserved\n');
    expect(fs.readdirSync(root)).toEqual(['preserved.json']);
  });
});
