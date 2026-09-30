import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createCodexAdapter } = require('../../src/main/provider-codex-adapter');
let root, adapter;
afterEach(async () => {
  adapter?.close();
  adapter = null;
  if (root) {
    expect(path.dirname(root)).toBe(await fs.realpath(os.tmpdir()));
    expect((await fs.lstat(root)).isSymbolicLink()).toBe(false);
    await fs.rm(root, { recursive: true, force: true });
    root = null;
  }
});
it('keeps unsupported Codex ask blocked before the independently counted dummy effect', async () => {
  root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'aegis-provider-red-'));
  const policyPath = path.join(root, 'policy.json');
  await fs.writeFile(
    policyPath,
    JSON.stringify({
      schemaVersion: 1,
      cwd: root,
      defaultDecision: 'deny',
      rules: [{ tool: 'Bash', input: { command: 'fixed-dummy-edit' }, decision: 'ask' }],
    }),
  );
  adapter = createCodexAdapter({ policyPath, cwd: root, sessionId: 'dummy-session' });
  const raw = Buffer.from(
    JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 'dummy-session',
      tool_use_id: 'dummy-action',
      tool_name: 'Bash',
      cwd: root,
      tool_input: { command: 'fixed-dummy-edit' },
      turn_id: 'dummy-turn',
      model: 'dummy-model',
    }),
  );
  const result = await adapter.before(raw);
  let effects = 0;
  if (result.wire.hookSpecificOutput.permissionDecision === 'allow') {
    effects++;
    await fs.writeFile(path.join(root, 'sentinel'), Buffer.from([0x5a]), { flag: 'wx' });
  }
  expect(effects).toBe(0);
  await expect(fs.stat(path.join(root, 'sentinel'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(result.decision).toBe('ask');
  expect(result.wire.hookSpecificOutput.permissionDecision).toBe('deny');
});
