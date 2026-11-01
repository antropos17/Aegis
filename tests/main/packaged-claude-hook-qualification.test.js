import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const {
  post,
  failureSummary,
  classifyOutput,
  fixtureEnvironment,
  assertArchivedProfileSourcesMatch,
} = require('../../scripts/qualification/packaged-claude-hook.cjs');
const { createPackage } = require('@electron/asar');

it('compares packaged Guard, hook, entry and shared sources against the selected checkout', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'aegis-package-source-'));
  try {
    const original = path.resolve('src/main');
    const source = path.join(directory, 'source', 'src', 'main');
    const packed = path.join(directory, 'packed', 'src', 'main');
    await fs.mkdir(source, { recursive: true });
    await fs.mkdir(packed, { recursive: true });
    const names = (await fs.readdir(original)).filter((name) =>
      /^claude-(?:hook|guard).*\.js$/.test(name),
    );
    names.push(
      'action-policy.js',
      'action-policy-hook.js',
      'command-hook-input.js',
      'owned-gui-profile.js',
      'cli.js',
      'main.js',
      'hook-startup-args.js',
    );
    for (const name of names) {
      await fs.copyFile(path.join(original, name), path.join(source, name));
      await fs.copyFile(path.join(original, name), path.join(packed, name));
    }
    const archive = path.join(directory, 'fixture.asar');
    await createPackage(path.join(directory, 'packed'), archive);
    await expect(
      assertArchivedProfileSourcesMatch(archive, path.join(directory, 'source')),
    ).resolves.toBeUndefined();
    for (const name of [
      'claude-guard-admission.js',
      'claude-guard-launch.js',
      'claude-guard-broker.js',
      'claude-guard-receiver.js',
      'claude-guard-report.js',
      'owned-gui-profile.js',
      'hook-startup-args.js',
      'action-policy.js',
    ]) {
      await fs.appendFile(path.join(source, name), '\n// fixture mismatch\n');
      await expect(
        assertArchivedProfileSourcesMatch(archive, path.join(directory, 'source')),
      ).rejects.toThrow();
      await fs.copyFile(path.join(original, name), path.join(source, name));
    }
    await fs.rm(path.join(packed, 'claude-guard-admission.js'));
    const missing = path.join(directory, 'missing.asar');
    await createPackage(path.join(directory, 'packed'), missing);
    await expect(
      assertArchivedProfileSourcesMatch(missing, path.join(directory, 'source')),
    ).rejects.toThrow();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

it('removes inherited Guard credentials from every fixture child base environment', () => {
  const inherited = {
    AEGIS_CLAUDE_GUARD_PORT: '1234',
    AEGIS_CLAUDE_GUARD_SESSION: 'PRIVATE_SESSION',
    AEGIS_CLAUDE_GUARD_CAPABILITY: 'PRIVATE_CAPABILITY',
    aegis_claude_guard_port: '4321',
    NODE_OPTIONS: 'PRIVATE_OPTIONS',
    PATH: 'fixture-path',
  };
  expect(fixtureEnvironment(inherited)).toEqual({ PATH: 'fixture-path' });
  expect(inherited.AEGIS_CLAUDE_GUARD_CAPABILITY).toBe('PRIVATE_CAPABILITY');
});

it('classifies bounded stdout without retaining its content', () => {
  expect(classifyOutput(Buffer.alloc(0))).toBe('empty');
  expect(classifyOutput(Buffer.from([10]))).toBe('lf');
  expect(classifyOutput(Buffer.from([13, 10]))).toBe('crlf');
  expect(classifyOutput(Buffer.from([9, 10, 13, 32]))).toBe('ascii-whitespace');
  expect(classifyOutput(Buffer.from('PRIVATE_CHILD_OUTPUT'))).toBe('other');
});

it('keeps malformed child output out of failure receipts', () => {
  let receipt;
  try {
    JSON.parse('PRIVATE_CHILD_OUTPUT');
  } catch {
    receipt = failureSummary('PostToolUse-after');
  }
  expect(receipt).toEqual({
    complete: false,
    failureStage: 'PostToolUse-after',
    failure: 'Qualification failed; see bounded stage and case evidence.',
  });
  expect(JSON.stringify(receipt)).not.toContain('PRIVATE_CHILD_OUTPUT');
});

it.each(['hang', 'oversize'])('bounds a %s local observer response', async (behavior) => {
  const server = http.createServer((_request, response) => {
    if (behavior === 'oversize') response.end('x'.repeat(8193));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const started = Date.now();
    await expect(
      post({ port: server.address().port, sessionId: 'fixture' }, 'claim', {}, null, 100),
    ).rejects.toThrow(behavior === 'hang' ? 'deadline exceeded' : 'exceeded limit');
    expect(Date.now() - started).toBeLessThan(2000);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
