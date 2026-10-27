'use strict';

const { createHash } = require('node:crypto');
const { scanJson, previewEdits } = require('./claude-hook-json');
const {
  profileCommand,
  profileAfterCommand,
  profileAfterCommandLegacy,
} = require('./claude-hook-app-profile');
const { IO_CONTRACT } = require('./claude-hook-writer');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const result = (code) => Object.freeze({ code });

function recognized(command, executable, appPath) {
  if (typeof command !== 'string') return false;
  const match = /^"[^"]+" "[^"]+" --action-policy-hook "([^"]+)"$/.exec(command);
  if (!match) return false;
  try {
    return profileCommand(executable, appPath, match[1]) === command;
  } catch {
    return false;
  }
}

function isHookCommand(command, after) {
  if (typeof command !== 'string') return false;
  return after
    ? /^"[^"]+" "[^"]+" --action-policy-after-hook(?:\s|$)/u.test(command)
    : /^"[^"]+" "[^"]+" --action-policy-hook(?:\s|$)/u.test(command);
}

function exactEntry(entry, expected) {
  const children = entry?.members.get('hooks');
  const hook = children?.items[0];
  return (
    entry?.kind === 'object' &&
    entry.members.size === 2 &&
    entry.members.get('matcher')?.value === 'Bash' &&
    children?.kind === 'array' &&
    children.items.length === 1 &&
    hook?.kind === 'object' &&
    hook.members.size === 3 &&
    hook.members.get('type')?.value === 'command' &&
    hook.members.get('timeout')?.value === 5 &&
    hook.members.get('command')?.value === expected
  );
}

function removeEntry(array, entry, edits) {
  const index = array.items.indexOf(entry);
  edits.push({ start: entry.start, end: entry.end, text: '' });
  if (array.items.length > 1) {
    const comma = array.commas[index ? index - 1 : 0];
    edits.push({ start: comma, end: comma + 1, text: '' });
  }
}

/** Plan a fresh removal of one exactly recognized current AEGIS Bash entry.
 * No historical manifest, backup reference or ownership assertion is accepted.
 * @param {Buffer} bytes Current private profile. @param {object} selection Fixed app paths.
 * @returns {object} Private exact edits/after bytes or a fixed refusal. @since v0.21.0 */
function planObservedRemoval(bytes, { target, executable, appPath }) {
  let source;
  try {
    source = scanJson(bytes);
    const hooks = source.root.members.get('hooks');
    const array = hooks?.members.get('PreToolUse');
    if (
      source.root.kind !== 'object' ||
      (hooks && hooks.kind !== 'object') ||
      (array && array.kind !== 'array')
    )
      return result('PLAN_REFUSED');
    const matches = (array?.items || []).filter((entry) =>
      entry.members
        .get('hooks')
        ?.items.some((hook) => recognized(hook.members.get('command')?.value, executable, appPath)),
    );
    if (!matches.length) return result('NO_MATCHING_HOOK');
    if (matches.length !== 1) return result('AMBIGUOUS_HOOK');
    if (
      (array?.items || []).some((item) =>
        item.members.get('hooks')?.items.some((hook) => {
          const value = hook.members.get('command')?.value;
          return isHookCommand(value, true);
        }),
      )
    )
      return result('PLAN_REFUSED');
    const entry = matches[0];
    const command = entry.members.get('hooks')?.items[0]?.members.get('command')?.value;
    if (!exactEntry(entry, command)) return result('PLAN_REFUSED');
    const policy = /^"[^"]+" "[^"]+" --action-policy-hook "([^"]+)"$/.exec(command)?.[1];
    if (!policy) return result('PLAN_REFUSED');
    const afterCommands = [
      profileAfterCommand(executable, appPath, policy),
      profileAfterCommandLegacy(executable, appPath, policy),
    ];
    const afterEntries = [];
    for (const event of ['PostToolUse', 'PostToolUseFailure']) {
      const selected = hooks?.members.get(event);
      if (selected && selected.kind !== 'array') return result('PLAN_REFUSED');
      if (
        (selected?.items || []).some((item) =>
          item.members.get('hooks')?.items.some((hook) => {
            const value = hook.members.get('command')?.value;
            return isHookCommand(value, false);
          }),
        )
      )
        return result('PLAN_REFUSED');
      const candidates = (selected?.items || []).filter((item) =>
        item.members.get('hooks')?.items.some((hook) => {
          const value = hook.members.get('command')?.value;
          return isHookCommand(value, true);
        }),
      );
      if (candidates.length > 1) return result('AMBIGUOUS_HOOK');
      const form = candidates.length
        ? afterCommands.findIndex((expected) => exactEntry(candidates[0], expected))
        : -1;
      if (candidates.length && form === -1) return result('PLAN_REFUSED');
      afterEntries.push({ array: selected, entry: candidates[0], form });
    }
    if (
      afterEntries.some((item) => item.entry) &&
      (!afterEntries.every((item) => item.entry) || afterEntries[0].form !== afterEntries[1].form)
    )
      return result('PLAN_REFUSED');
    const edits = [];
    removeEntry(array, entry, edits);
    for (const item of afterEntries) if (item.entry) removeEntry(item.array, item.entry, edits);
    const review = previewEdits(source, target, edits);
    if (afterEntries.every((item) => item.entry))
      review.eventNames = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'];
    let text = source.text;
    for (const edit of [...edits].sort((a, b) => b.start - a.start))
      text = text.slice(0, edit.start) + text.slice(edit.end);
    const after = Buffer.from(text);
    if (hash(after) !== review.afterSha256) {
      after.fill(0);
      return result('PLAN_REFUSED');
    }
    return { ok: true, review, after, mode: review.eventNames ? 'three-hook' : 'legacy' };
  } catch {
    return result('PLAN_REFUSED');
  } finally {
    source?.bytes.fill(0);
  }
}

/** Prepare a single fresh owner-review transaction using the existing guarded IO.
 * The private capability never imports old ownership or performs historical rollback.
 * @param {object} io Trusted native owned-target IO. @param {object} selection Fixed paths/clock.
 * @returns {Promise<object>} Private review/one-shot confirm or fixed refusal. @since v0.21.0 */
async function prepareObservedRemoval(io, selection) {
  let before, after, review, identity, expires, created;
  const finish = () => {
    before?.fill(0);
    after?.fill(0);
  };
  try {
    if (io?.contract !== IO_CONTRACT) return result('PLAN_REFUSED');
    const snapshot = await io.readTarget();
    try {
      if (
        typeof snapshot.identity !== 'string' ||
        !snapshot.identity ||
        snapshot.identity.length > 256 ||
        !Buffer.isBuffer(snapshot.bytes) ||
        snapshot.bytes.length > 262144
      )
        return result('TARGET_READ_FAILED');
      identity = snapshot.identity;
      before = Buffer.from(snapshot.bytes);
    } finally {
      snapshot.bytes?.fill(0);
    }
    const plan = planObservedRemoval(before, selection);
    if (!plan.ok) {
      finish();
      return plan;
    }
    ({ after, review } = plan);
    created = selection.now();
    if (!Number.isFinite(created) || created < 0) {
      finish();
      return result('EXPIRED');
    }
    expires = created + 90000;
    if (!Number.isFinite(expires) || expires <= created) {
      finish();
      return result('EXPIRED');
    }
  } catch {
    finish();
    return result('TARGET_READ_FAILED');
  }
  let consumed = false;
  const cancel = () => {
    if (!consumed) {
      consumed = true;
      finish();
    }
  };
  async function confirm(confirmed) {
    if (consumed || confirmed !== true) return result('INVALID_APPROVAL');
    consumed = true;
    let dispatched = false;
    try {
      const now = selection.now();
      if (!Number.isFinite(now) || now < created || now >= expires) return result('EXPIRED');
      const manifest = JSON.stringify({
        schema: 'aegis-observed-hook-removal-backup/1',
        pathSha256: hash(selection.target),
        beforeSha256: review.beforeSha256,
        afterSha256: review.afterSha256,
      });
      let reference, backup;
      try {
        reference = await io.retainPrivate({ bytes: Buffer.from(before), manifest });
        if (!reference || typeof reference !== 'object') return result('BACKUP_FAILED');
        backup = await io.readPrivate(reference);
        if (
          !Buffer.isBuffer(backup?.bytes) ||
          !backup.bytes.equals(before) ||
          backup.manifest !== manifest
        )
          return result('BACKUP_TAMPERED');
      } catch {
        return result('BACKUP_FAILED');
      } finally {
        backup?.bytes?.fill(0);
      }
      let current;
      try {
        current = await io.readTarget();
        if (current.identity !== identity) return result('TARGET_IDENTITY_CHANGED');
        if (!Buffer.isBuffer(current.bytes) || !current.bytes.equals(before))
          return result('TARGET_CHANGED');
      } catch {
        return result('TARGET_READ_FAILED');
      } finally {
        current?.bytes?.fill(0);
      }
      dispatched = true;
      const outcome = await io.compareAndWrite({
        identity,
        beforeBytes: Buffer.from(before),
        afterBytes: Buffer.from(after),
      });
      if (outcome === 'stale') return result('TARGET_CHANGED');
      if (outcome !== 'written') return result('WRITE_UNCERTAIN');
      let written;
      try {
        written = await io.readTarget();
        if (
          written.identity !== identity ||
          !Buffer.isBuffer(written.bytes) ||
          !written.bytes.equals(after)
        )
          return result('READBACK_FAILED');
      } catch {
        return result('READBACK_FAILED');
      } finally {
        written?.bytes?.fill(0);
      }
      return result('OBSERVED_REMOVED');
    } catch {
      return result(dispatched ? 'WRITE_UNCERTAIN' : 'BACKUP_FAILED');
    } finally {
      finish();
    }
  }
  return Object.freeze({ ok: true, review, confirm, cancel });
}

module.exports = { planObservedRemoval, prepareObservedRemoval };
