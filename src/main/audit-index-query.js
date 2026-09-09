'use strict';

const { normalizeAuditEntry } = require('./audit-normalize');
const { MARKER_TYPE } = require('./audit-drop-tracker');

// At most one statement per validated filter length, per connection. Closed connections
// are not retained by this cache. Values are always bound, including event type names.
const statements = new WeakMap();

/**
 * Read a bounded history page from a ready projection. Parameters are validated by
 * audit-logger.getEntriesBefore. Timestamp order handles clock steps; reversing the
 * selected page preserves the renderer's oldest-first contract. Raw records retain
 * fields the projection does not model, including the absence of v0 evidence.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} beforeTs - exclusive timestamp cursor
 * @param {number} limit - validated page size
 * @param {Set<string>|null} types - normalized filter
 * @param {number} [boundaryOffset] Inclusive boundary rows already consumed
 * @returns {Object[]} normalized records, oldest first
 * @since v0.14.0
 */
function queryBefore(db, beforeTs, limit, types, boundaryOffset) {
  const values = types ? [...types] : [];
  let cache = statements.get(db);
  if (!cache) statements.set(db, (cache = new Map()));
  const inclusive = boundaryOffset !== undefined;
  const cacheKey = `${values.length}:${inclusive}`;
  let stmt = cache.get(cacheKey);
  if (!stmt) {
    // A missing/non-string type projects to ''. An explicitly empty-string filter
    // must match only a recorded empty string, as it does in the JSONL reader.
    const filter = values.length
      ? ` AND type IN (${values.map(() => '?').join(',')})
          AND (type != '' OR json_type(raw, '$.type') = 'text')`
      : '';
    stmt = db.prepare(`SELECT raw FROM audit_events
      WHERE timestamp != '' AND timestamp ${inclusive ? '<=' : '<'} ? AND type != ?${filter}
      ORDER BY timestamp DESC, file DESC, line_no DESC LIMIT ? OFFSET ?`);
    cache.set(cacheKey, stmt);
  }
  return stmt
    .all(beforeTs, MARKER_TYPE, ...values, limit, boundaryOffset ?? 0)
    .map(({ raw }) => normalizeAuditEntry(JSON.parse(raw)))
    .reverse();
}

module.exports = { queryBefore };
