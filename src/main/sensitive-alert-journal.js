/** @file Bounded private review state for sensitive file observations. @since v0.17.0 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const FILE_NAME = 'sensitive-alerts.json';
const LIMIT = 100;
const MAX_BYTES = 64 * 1024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEMP_FILE = /^\.sensitive-alerts-([0-9a-f-]{36})\.tmp$/i;
const TEMP_RETENTION_MS = 60 * 60 * 1000;
const ACTIONS = new Set(['created', 'modified', 'deleted', 'accessed', 'holding']);

/** @param {unknown} value @param {number} max @returns {string} */
function shortText(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** @param {unknown} value @returns {boolean} */
function validEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof row.eventId === 'string' &&
    UUID.test(row.eventId) &&
    Number.isFinite(row.timestamp) &&
    Number.isInteger(row.timestamp) &&
    typeof row.basename === 'string' &&
    row.basename.length > 0 &&
    row.basename.length <= 200 &&
    !/[/\\]/.test(row.basename) &&
    ACTIONS.has(row.action) &&
    typeof row.agent === 'string' &&
    row.agent.length <= 100 &&
    ['confirmed', 'inferred', 'unattributed'].includes(row.attribution) &&
    typeof row.reviewed === 'boolean'
  );
}

/**
 * Create a journal scoped to one Electron userData directory. No observed full path,
 * reason, PID, instance key, credential contents or audit sequence enters this file.
 * @param {string} userDataPath
 * @param {typeof fs} [io] - Test seam for write errors.
 * @returns {{list: () => {success: true, status: string, items: object[]}, record: (event: object) => void, flush: () => Promise<boolean>, hasPending: () => boolean, setReviewed: (id: unknown, reviewed: unknown, canComplete?: () => boolean) => Promise<{success: boolean, status: string, error?: string}>}}
 * @since v0.17.0
 */
function createSensitiveAlertJournal(userDataPath, io = fs) {
  const target = path.join(userDataPath, FILE_NAME);
  // Only closed, old temporary files matching this journal's own UUID names are
  // disposable. Never recurse into userData or follow reparse points.
  if (typeof io.readdirSync === 'function' && typeof io.lstatSync === 'function') {
    try {
      let removed = 0;
      for (const entry of io.readdirSync(userDataPath, { withFileTypes: true })) {
        const match = TEMP_FILE.exec(entry.name);
        if (!match || !UUID.test(match[1]) || entry.isSymbolicLink() || !entry.isFile()) continue;
        const candidate = path.join(userDataPath, entry.name);
        if (path.dirname(path.resolve(candidate)) !== path.resolve(userDataPath)) continue;
        try {
          const info = io.lstatSync(candidate);
          if (
            info.isFile() &&
            !info.isSymbolicLink() &&
            info.size <= MAX_BYTES &&
            Date.now() - info.mtimeMs > TEMP_RETENTION_MS
          ) {
            io.unlinkSync(candidate); // Locked files fail and are left in place.
            if (++removed >= 32) break;
          }
        } catch {
          // A changed or locked candidate is not ours to force-remove.
        }
      }
    } catch {
      // Retention is best effort; journal restore still proceeds.
    }
  }
  /** @type {Array<{eventId:string,timestamp:number,basename:string,action:string,agent:string,attribution:string,reviewed:boolean}>} */
  let items = [];
  let status = 'ready';
  let revision = 0;
  let savedRevision = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let writes = Promise.resolve();
  let recordWriteQueued = false;
  let reviewBusy = false;
  const now = Date.now();
  try {
    const stat = io.statSync(target);
    if (stat.size > MAX_BYTES) throw new Error('oversize');
    const parsed = JSON.parse(io.readFileSync(target, 'utf8'));
    if (
      !parsed ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.items) ||
      parsed.items.length > LIMIT ||
      parsed.items.some((row) => !validEntry(row)) ||
      new Set(parsed.items.map((row) => row.eventId)).size !== parsed.items.length
    )
      throw new Error('invalid');
    items = parsed.items
      .filter((row) => row.timestamp <= now && now - row.timestamp <= MAX_AGE_MS)
      .map((row) => ({
        eventId: row.eventId,
        timestamp: row.timestamp,
        basename: row.basename,
        action: row.action,
        agent: row.agent,
        attribution: row.attribution,
        reviewed: row.reviewed,
      }));
    if (items.length !== parsed.items.length) {
      revision++;
      schedule();
    }
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') status = 'corrupt';
  }

  async function persist(next, canComplete = () => true, syncReview = false) {
    const serialized = JSON.stringify({ version: 1, items: next });
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) {
      status = 'write-error';
      return false;
    }
    const temporary = path.join(userDataPath, `.sensitive-alerts-${randomUUID()}.tmp`);
    let replaced = false;
    try {
      if (!canComplete()) return false;
      await io.promises.writeFile(temporary, serialized, { mode: 0o600, flag: 'wx' });
      if (syncReview) {
        const handle = await io.promises.open(temporary, 'r+');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      // A review belongs to the renderer that requested it. The final review
      // replacement is synchronous, so navigation cannot interleave this check
      // and the commit on the Electron main thread.
      if (!canComplete()) return false;
      if (syncReview) io.renameSync(temporary, target);
      else await io.promises.rename(temporary, target);
      replaced = true;
      status = 'ready';
      return true;
    } catch {
      status = 'write-error';
      return false;
    } finally {
      if (!replaced) {
        try {
          await io.promises.unlink(temporary);
        } catch {
          // A failed temporary cleanup must not replace the write result.
        }
      }
    }
  }

  function enqueue(operation) {
    const result = writes.then(operation);
    writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function schedule() {
    if (timer !== null || recordWriteQueued) return;
    timer = setTimeout(() => {
      timer = null;
      recordWriteQueued = true;
      enqueue(async () => {
        const writingRevision = revision;
        try {
          if (await persist(items.slice())) savedRevision = writingRevision;
        } finally {
          recordWriteQueued = false;
          if (revision !== writingRevision) schedule();
        }
      }).catch(() => {
        status = 'write-error';
      });
    }, 100);
  }

  return {
    hasPending() {
      return revision > savedRevision || reviewBusy || recordWriteQueued;
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      return enqueue(async () => {
        if (revision <= savedRevision) return true;
        const writingRevision = revision;
        const okay = await persist(items.slice());
        if (okay) savedRevision = writingRevision;
        if (revision !== writingRevision) schedule();
        return okay;
      });
    },
    list() {
      const now = Date.now();
      const current = items.filter(
        (row) => row.timestamp <= now && now - row.timestamp <= MAX_AGE_MS,
      );
      if (current.length !== items.length) {
        items = current;
        revision++;
        schedule();
      }
      return { success: true, status, items: items.map((row) => ({ ...row })) };
    },
    record(event) {
      if (!event || event.sensitive !== true || !UUID.test(event.eventId || '')) return;
      if (items.some((row) => row.eventId === event.eventId)) return;
      if (typeof event.file !== 'string' || event.file.length > 32768) return;
      if (!ACTIONS.has(event.action)) return;
      const basename = path.basename(event.file.replace(/\\/g, '/')).slice(0, 200);
      if (!basename) return;
      const row = {
        eventId: event.eventId,
        timestamp: Number.isFinite(event.timestamp) ? Math.trunc(event.timestamp) : Date.now(),
        basename,
        action: event.action,
        agent: shortText(event.agent, 100),
        attribution: ['confirmed', 'inferred', 'unattributed'].includes(event.attribution?.status)
          ? event.attribution.status
          : 'unattributed',
        reviewed: false,
      };
      const now = Date.now();
      const next = [row, ...items.filter((item) => now - item.timestamp <= MAX_AGE_MS)].slice(
        0,
        LIMIT,
      );
      items = next;
      revision++;
      schedule();
    },
    async setReviewed(id, reviewed, canComplete = () => true) {
      if (typeof id !== 'string' || !UUID.test(id) || typeof reviewed !== 'boolean')
        return { success: false, status, error: 'Invalid review request' };
      if (typeof canComplete !== 'function' || !canComplete())
        return { success: false, status, error: 'Renderer request denied' };
      if (reviewBusy) return { success: false, status, error: 'Review is busy' };
      reviewBusy = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        return await enqueue(async () => {
          if (!canComplete()) return { success: false, status, error: 'Renderer request denied' };
          if (!items.some((row) => row.eventId === id))
            return { success: false, status, error: 'Alert is unavailable' };
          const writingRevision = revision;
          const next = items.map((row) => (row.eventId === id ? { ...row, reviewed } : row));
          if (!(await persist(next, canComplete, true))) {
            if (revision !== writingRevision) schedule();
            if (!canComplete()) return { success: false, status, error: 'Renderer request denied' };
            return { success: false, status, error: 'Review could not be saved' };
          }
          items = items.map((row) => (row.eventId === id ? { ...row, reviewed } : row));
          revision++;
          savedRevision = writingRevision + 1;
          if (revision !== writingRevision + 1) schedule();
          return { success: true, status };
        });
      } finally {
        reviewBusy = false;
      }
    },
  };
}

module.exports = { createSensitiveAlertJournal, LIMIT, MAX_BYTES, MAX_AGE_MS };
