import fs from 'node:fs/promises';
import { lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

// Retained by this ESM evaluation, including when an importer later reuses its cached body.
export const providerCorpusLoadedSha256 = (() => {
  try {
    const file = new URL(import.meta.url),
      stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return null;
    const bytes = readFileSync(file);
    return bytes.length <= 65536 ? createHash('sha256').update(bytes).digest('hex') : null;
  } catch {
    return null;
  }
})();

export const SCENARIOS = Object.freeze([
  'read',
  'edit',
  'test',
  'deny',
  'pending',
  'missing-hook',
  'invalid-hook',
  'timed-out-hook',
  'mismatched-identity',
  'mismatched-input',
  'duplicate-completion',
  'late-completion',
  'lost-response',
  'false-completion',
]);
export const ALLOWED = Object.freeze([
  'read',
  'edit',
  'test',
  'duplicate-completion',
  'late-completion',
  'lost-response',
  'false-completion',
]);
export const FIXED_INPUT = Object.freeze({ command: 'fixed-dummy-fixture-operation' });
const expectedByte = (scenario) => (scenario === 'read' ? 0x51 : scenario === 'test' ? 0x74 : 0x5a);

/** Create only generated harmless files; message commands are labels, never executed.
 * @returns {Promise<object>} Fixed byte receiver and independent disk oracle. @since v0.17.0 */
export async function createProviderCorpus() {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'aegis-provider-replay-'));
  let closed = false,
    deliveries = 0;
  const cleanup = async () => {
    if (closed) return;
    if (
      path.dirname(root) !== parent ||
      !path.basename(root).startsWith('aegis-provider-replay-') ||
      (await fs.lstat(root)).isSymbolicLink() ||
      (await fs.realpath(root)) !== root
    )
      throw Error('provider-cleanup-unsafe');
    const queue = [root];
    let count = 0;
    while (queue.length)
      for (const entry of await fs.readdir(queue.pop(), { withFileTypes: true })) {
        if (++count > 128 || entry.isSymbolicLink()) throw Error('provider-cleanup-unsafe');
        const name = path.join(entry.parentPath, entry.name);
        if (entry.isDirectory()) queue.push(name);
        else if (!entry.isFile()) throw Error('provider-cleanup-unsafe');
      }
    await fs.rm(root, { recursive: true, force: true });
    closed = true;
  };
  try {
    await fs.writeFile(path.join(root, 'source.bin'), Buffer.from([0x51]), { flag: 'wx' });
    const select = (label) => {
      if (
        !SCENARIOS.includes(label) &&
        !['recovery-failed', 'recovery-stale', 'recovery-fresh'].includes(label)
      )
        throw Error('provider-scenario-invalid');
      return path.join(root, label + '.bin');
    };
    return Object.freeze({
      root,
      cleanup,
      async receive(label) {
        const destination = select(label);
        if (closed || ++deliveries > 32) throw Error('provider-receiver-limit');
        const bytes = await fs.readFile(path.join(root, 'source.bin'));
        if (!bytes.equals(Buffer.from([0x51]))) throw Error('provider-source-mismatch');
        await fs.writeFile(destination, Buffer.from([expectedByte(label)]), { flag: 'wx' });
        if (label === 'lost-response' || label === 'recovery-failed')
          throw Error('provider-injected-loss');
      },
      async observe(label) {
        let bytes;
        try {
          bytes = await fs.readFile(select(label));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          return Object.freeze({ present: false, bytesMatch: false });
        }
        return Object.freeze({
          present: true,
          bytesMatch: bytes.length === 1 && bytes[0] === expectedByte(label),
        });
      },
      deliveries: () => deliveries,
    });
  } catch (original) {
    let failure;
    try {
      await cleanup();
    } catch (error) {
      failure = error;
    }
    if (failure)
      throw new AggregateError([original, failure], 'provider-setup-cleanup-failed', {
        cause: original,
      });
    throw original;
  }
}

/** Build the distinct versioned finite provider hook payloads.
 * @param {string} provider Fixed provider. @param {string} cwd Owned fixture path.
 * @param {string} id Owner action label. @param {boolean} after Completion phase.
 * @returns {Buffer} Private hook bytes. @since v0.17.0 */
export function providerMessage(provider, cwd, id, after = false) {
  if (!['claude', 'codex'].includes(provider)) throw Error('provider-invalid');
  return Buffer.from(
    JSON.stringify({
      hook_event_name: after ? 'PostToolUse' : 'PreToolUse',
      session_id: 'dummy-session',
      tool_use_id: id,
      tool_name: 'Bash',
      cwd,
      tool_input: FIXED_INPUT,
      ...(provider === 'codex' ? { turn_id: 'dummy-turn', model: 'dummy-model' } : {}),
      ...(after ? { tool_response: { reported: 'completed' } } : {}),
    }),
  );
}

/** Write a finite fixture policy consumed by the existing evaluator.
 * @param {string} cwd Owned context. @param {string} decision Selected corpus decision.
 * @returns {Promise<{policyPath:string,bytes:Buffer}>} Private policy and its owned digest input. @since v0.17.0 */
export async function writeProviderPolicy(cwd, decision) {
  if (!['allow', 'ask', 'deny'].includes(decision)) throw Error('provider-policy-invalid');
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      cwd,
      defaultDecision: 'deny',
      rules: [{ tool: 'Bash', input: FIXED_INPUT, decision }],
    }),
  );
  const policyPath = path.join(cwd, `policy-${decision}.json`);
  await fs.writeFile(policyPath, bytes, { flag: 'wx' });
  return { policyPath, bytes };
}
