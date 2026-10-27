import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createClaudeGuardSnapshot } = require('../../src/main/claude-guard-snapshot');
const service = require('../../src/main/local-security-review');
let root, cwd, baselineFile;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-launch-snapshot-'));
  cwd = path.join(root, 'project');
  baselineFile = path.join(root, 'accepted.json');
  await fs.mkdir(cwd);
  await fs.writeFile(path.join(cwd, 'AGENTS.md'), 'Project instruction.\n');
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));

async function accepted(toolsFile) {
  const retained = await service.review({
    mode: 'inventory',
    adapter: 'project',
    directory: cwd,
    toolsFile,
  });
  return service.accept(retained, retained.snapshot.digest, baselineFile);
}

function gate(extra = {}) {
  return createClaudeGuardSnapshot({ cwd, baselineFile, ...extra });
}

describe('Claude launch accepted project snapshot gate', () => {
  it('requires explicit acceptance and validates the unchanged selected project', async () => {
    const observed = await service.review({
      mode: 'inventory',
      adapter: 'project',
      directory: cwd,
    });
    await service.saveSnapshot(observed, baselineFile);
    expect(await gate().bind()).toBe('SNAPSHOT_REVIEW_REQUIRED');
    await fs.unlink(baselineFile);
    await accepted();
    const candidate = gate();
    expect(await candidate.bind()).toBe('SNAPSHOT_OK');
    expect(await candidate.verify()).toBe(true);
    candidate.close();
    expect(await candidate.verify()).toBe(false);
  });

  it('fails closed when project contents change after the accepted capture', async () => {
    await accepted();
    const candidate = gate();
    expect(await candidate.bind()).toBe('SNAPSHOT_OK');
    await fs.writeFile(path.join(cwd, 'AGENTS.md'), 'Changed instruction.\n');
    expect(await candidate.verify()).toBe(false);
    expect(await gate().bind()).toBe('SNAPSHOT_REVIEW_REQUIRED');
  });

  it('refuses a different project and missing or unreadable snapshots', async () => {
    await accepted();
    const other = path.join(root, 'other');
    await fs.mkdir(other);
    expect(await gate({ cwd: other }).bind()).toBe('SNAPSHOT_INCOMPATIBLE');
    expect(await gate({ baselineFile: path.join(root, 'missing.json') }).bind()).toBe(
      'SNAPSHOT_UNAVAILABLE',
    );
  });

  it('detects a rewritten accepted snapshot even if its JSON remains valid', async () => {
    await accepted();
    const candidate = gate();
    expect(await candidate.bind()).toBe('SNAPSHOT_OK');
    const data = await fs.readFile(baselineFile, 'utf8');
    await fs.writeFile(baselineFile, ` ${data}`);
    expect(await candidate.verify()).toBe(false);
  });

  it('rejects a baseline rewritten while fresh comparison is in progress', async () => {
    await accepted();
    const candidate = gate({
      review: async (...args) => {
        const result = await service.review(...args);
        await fs.appendFile(baselineFile, ' ');
        return result;
      },
    });
    expect(await candidate.bind()).toBe('SNAPSHOT_REVIEW_REQUIRED');
  });

  it('refuses a snapshot stored within the selected project', async () => {
    await accepted();
    const inProject = path.join(cwd, 'accepted.json');
    await fs.copyFile(baselineFile, inProject);
    expect(await gate({ baselineFile: inProject }).bind()).toBe('SNAPSHOT_UNAVAILABLE');
  });

  it('requires the selected catalog and binds its bytes and source', async () => {
    const toolsFile = path.join(root, 'tools.json');
    await fs.writeFile(
      toolsFile,
      JSON.stringify({ tools: [{ name: 'example', inputSchema: { type: 'object' } }] }),
    );
    await accepted(toolsFile);
    expect(await gate().bind()).toBe('SNAPSHOT_CATALOG_REQUIRED');
    const candidate = gate({ toolsFile });
    expect(await candidate.bind()).toBe('SNAPSHOT_OK');
    expect(await candidate.verify()).toBe(true);
    await fs.appendFile(toolsFile, ' ');
    expect(await candidate.verify()).toBe(false);
  });

  it('rejects an incomplete capture instead of treating unknown files as unchanged', async () => {
    await accepted();
    const actual = service.review;
    const candidate = gate({
      review: async (...args) => {
        const result = await actual(...args);
        return { ...result, report: { ...result.report, status: 'incomplete', complete: false } };
      },
    });
    expect(await candidate.bind()).toBe('SNAPSHOT_INCOMPLETE');
  });

  it('retains one timed-out operation until it settles and never accepts a late result', async () => {
    await accepted();
    let release;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    const candidate = gate({
      timeoutMs: 15,
      review: async (...args) => {
        await waiting;
        return service.review(...args);
      },
    });
    expect(await candidate.bind()).toBe('SNAPSHOT_UNAVAILABLE');
    expect(candidate.hasPending()).toBe(true);
    expect(await candidate.bind()).toBe('SNAPSHOT_UNAVAILABLE');
    candidate.close();
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(candidate.hasPending()).toBe(false);
    expect(await candidate.verify()).toBe(false);
  });

  it('rejects a late capture even when synchronous work delayed the timeout callback', async () => {
    await accepted();
    const candidate = gate({
      timeoutMs: 20,
      review: async (...args) => {
        const result = await service.review(...args);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
        return result;
      },
    });
    expect(await candidate.bind()).toBe('SNAPSHOT_UNAVAILABLE');
    expect(await candidate.verify()).toBe(false);
  });

  it('does not admit concurrent verification or late results after closure', async () => {
    await accepted();
    let release;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const candidate = gate({
      review: async (...args) => {
        if (++calls > 1) await waiting;
        return service.review(...args);
      },
    });
    expect(await candidate.bind()).toBe('SNAPSHOT_OK');
    const first = candidate.verify();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await candidate.verify()).toBe(false);
    candidate.close();
    expect(candidate.hasPending()).toBe(true);
    release();
    expect(await first).toBe(false);
    expect(candidate.hasPending()).toBe(false);
  });
});
