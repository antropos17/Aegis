import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { binding, exactKeys, HEX64, requireVm } from './vm-contract.mjs';

const MAX_BYTES = 65536;
const MAX_ROWS = 128;
const ZERO = '0'.repeat(64);
const events = [
  'created',
  'start-intent',
  'ready',
  'release-intent',
  'released',
  'stop-intent',
  'cleanup-unknown',
  'stopped',
];
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function entry(value, expected) {
  exactKeys(value, ['sessionId', 'vmId', 'epoch', 'event']);
  const identity = binding({ sessionId: value.sessionId, vmId: value.vmId, epoch: value.epoch });
  requireVm(JSON.stringify(identity) === JSON.stringify(expected) && events.includes(value.event));
  return { ...identity, event: value.event };
}

/**
 * Create an exclusive bounded developer journal; fsync each intent before effects.
 * The hash chain detects damage, not malicious rewriting by the same host user.
 * @param {string} filename New task-owned path.
 * @param {object} identity Fixed synthetic resource registration.
 * @returns {{append: function(string): void, close: function(): void}}
 * @since v0.17.0
 */
export function createVmJournal(filename, identity) {
  const pinned = binding(identity);
  const fd = fs.openSync(filename, 'wx', 0o600);
  let index = 0;
  let previous = ZERO;
  let bytes = 0;
  let closed = false;
  let failed = false;
  return Object.freeze({
    append(event) {
      requireVm(!closed && !failed);
      try {
        const value = { version: 1, index, previous, entry: entry({ ...pinned, event }, pinned) };
        const hash = digest(value);
        const line = Buffer.from(JSON.stringify({ ...value, hash }) + '\n');
        requireVm(index < MAX_ROWS && bytes + line.length <= MAX_BYTES);
        let offset = 0;
        while (offset < line.length) {
          const count = fs.writeSync(fd, line, offset, line.length - offset);
          requireVm(count > 0);
          offset += count;
        }
        fs.fsyncSync(fd);
        bytes += line.length;
        index++;
        previous = hash;
      } catch {
        failed = true;
        throw new Error('vm-journal-unavailable');
      }
    },
    close() {
      if (!closed) {
        closed = true;
        fs.closeSync(fd);
      }
    },
  });
}

/**
 * Validate bounded persisted records against a separate supplied registration.
 * No record authorizes resuming: the only recovery action is confirmed cleanup.
 * @param {string} filename Existing task-owned journal.
 * @param {object} identity Separate expected registration, never inferred from the file.
 * @returns {Readonly<object>} Recovery metadata, always launchAllowed=false.
 * @since v0.17.0
 */
export function readVmJournal(filename, identity) {
  const pinned = binding(identity);
  requireVm(!fs.lstatSync(filename).isSymbolicLink());
  const fd = fs.openSync(filename, 'r');
  try {
    const stat = fs.fstatSync(fd);
    requireVm(stat.isFile() && stat.size > 0 && stat.size <= MAX_BYTES);
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      requireVm(count > 0);
      offset += count;
    }
    requireVm(fs.fstatSync(fd).size === stat.size);
    const text = bytes.toString('utf8');
    requireVm(text.endsWith('\n'));
    const lines = text.slice(0, -1).split('\n');
    requireVm(lines.length <= MAX_ROWS);
    let previous = ZERO;
    for (const [index, line] of lines.entries()) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        throw new Error('vm-journal-invalid');
      }
      exactKeys(row, ['version', 'index', 'previous', 'entry', 'hash']);
      const value = { version: 1, index, previous, entry: entry(row.entry, pinned) };
      requireVm(row.version === 1 && row.index === index && row.previous === previous);
      requireVm(typeof row.hash === 'string' && HEX64.test(row.hash) && digest(value) === row.hash);
      requireVm(line === JSON.stringify({ ...value, hash: row.hash }));
      previous = row.hash;
    }
    return Object.freeze({
      ...pinned,
      rows: lines.length,
      lastHash: previous,
      state: 'cleanup-unknown',
      launchAllowed: false,
    });
  } finally {
    fs.closeSync(fd);
  }
}
