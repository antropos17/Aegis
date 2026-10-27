import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const {
  planInstall,
  planRemoval,
  CONTRACT,
  CONTRACT_V2,
} = require('../../src/main/claude-hook-plan');
const { edited } = require('../../src/main/claude-hook-json');

const configPath = 'C:/Fixture/settings.json';
const command =
  '"C:/AEGIS/app.exe" "C:/AEGIS/app.asar" --action-policy-hook "C:/Fixture/policy.json"';
const afterCommand =
  '"C:/AEGIS/app.exe" "C:/AEGIS/app.asar" --action-policy-after-hook "C:/Fixture/policy.json"';
const selection = { configPath, command, afterCommand, contract: CONTRACT_V2, timeoutSeconds: 5 };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const entry = (value) => ({
  matcher: 'Bash',
  hooks: [{ type: 'command', command: value, timeout: 5 }],
});

describe('three-event owned profile planning', () => {
  it.each(['{}', '{"hooks":{}}', '{"hooks":{"PreToolUse":[],"PostToolUse":[],"Other":1}}'])(
    'inserts all three events in one reversible review: %s',
    (text) => {
      const before = Buffer.from(text);
      const plan = planInstall({ ...selection, configBytes: before });
      expect(plan.ok).toBe(true);
      const after = edited(before, plan);
      const parsed = JSON.parse(after);
      expect(parsed.hooks.PreToolUse).toEqual([entry(command)]);
      expect(parsed.hooks.PostToolUse.at(-1)).toEqual(entry(afterCommand));
      expect(parsed.hooks.PostToolUseFailure).toEqual([entry(afterCommand)]);
      const removal = planRemoval({
        configPath,
        configBytes: after,
        manifest: plan.manifest,
        manifestSha256: hash(plan.manifest),
      });
      expect(removal.mode).toBe('exact-rollback');
      expect(edited(after, removal).equals(before)).toBe(true);
    },
  );

  it('preserves unrelated bytes while removing each owned entry after an unrelated edit', () => {
    const before = Buffer.from(
      '{"note":"é😀","hooks":{"PreToolUse":[],"PostToolUse":[],"PostToolUseFailure":[]}}',
    );
    const plan = planInstall({ ...selection, configBytes: before });
    const after = edited(before, plan).toString().replace('"note":"é😀"', '"note":"preserve"');
    const removal = planRemoval({
      configPath,
      configBytes: Buffer.from(after),
      manifest: plan.manifest,
      manifestSha256: hash(plan.manifest),
    });
    expect(removal.mode).toBe('targeted-removal');
    expect(edited(Buffer.from(after), removal).toString()).toBe(
      '{"note":"preserve","hooks":{"PreToolUse":[],"PostToolUse":[],"PostToolUseFailure":[]}}',
    );
  });

  it('refuses partial and duplicate groups without altering the source', () => {
    for (const hooks of [
      { PreToolUse: [entry(command)] },
      { PostToolUse: [{ matcher: 'Read', hooks: [] }] },
      {
        PreToolUse: [entry(command)],
        PostToolUse: [entry(afterCommand)],
        PostToolUseFailure: [entry(afterCommand), entry(afterCommand)],
      },
    ]) {
      const bytes = Buffer.from(JSON.stringify({ hooks }));
      expect(planInstall({ ...selection, configBytes: bytes }).ok).toBe(false);
    }
  });

  it('retains the original pre-only v1 transaction', () => {
    const before = Buffer.from('{}');
    const plan = planInstall({
      configPath,
      configBytes: before,
      command,
      contract: CONTRACT,
      timeoutSeconds: 5,
    });
    const after = edited(before, plan);
    expect(Object.keys(JSON.parse(after).hooks)).toEqual(['PreToolUse']);
    const removal = planRemoval({
      configPath,
      configBytes: after,
      manifest: plan.manifest,
      manifestSha256: hash(plan.manifest),
    });
    expect(edited(after, removal).equals(before)).toBe(true);
  });
});

it('shows the exact redirected post commands and their effect in native review', () => {
  const path = require('node:path');
  const {
    profileCommand,
    profileAfterCommand,
    profileAfterCommandLegacy,
    profileReviewText,
  } = require('../../src/main/claude-hook-app-profile');
  const executable = path.resolve('fixture/app.exe');
  const app = path.resolve('fixture/app.asar');
  const policy = path.resolve('fixture/policy.json');
  const before = Buffer.from('{}');
  const pre = profileCommand(executable, app, policy);
  const post = profileAfterCommand(executable, app, policy);
  expect(post).toBe(profileAfterCommandLegacy(executable, app, policy) + ' > /dev/null');
  expect(pre).not.toContain('> /dev/null');
  const plan = planInstall({
    configPath,
    configBytes: before,
    command: pre,
    afterCommand: post,
    contract: CONTRACT_V2,
    timeoutSeconds: 5,
  });
  const detail = profileReviewText(plan, configPath);
  expect(detail).toContain(' > /dev/null');
  expect(detail).toContain('after-hook stdout is discarded');
  expect(detail).toContain('redirection or hook failure can leave delivery unknown');
  const installed = JSON.parse(edited(before, plan));
  expect(installed.hooks.PreToolUse[0].hooks[0].command).toBe(pre);
  expect(installed.hooks.PostToolUse[0].hooks[0].command).toBe(post);
  expect(installed.hooks.PostToolUseFailure[0].hooks[0].command).toBe(post);
});
