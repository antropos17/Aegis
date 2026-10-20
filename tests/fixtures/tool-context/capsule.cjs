'use strict';
// Synthetic custody contract fixtures. These are not provider/native verification receipts.
const candidate = (id = 1, extra = {}) => ({
  source: 'claude-code',
  sessionRef: 'a'.repeat(64),
  callRef: id.toString(16).padStart(64, '0'),
  toolName: 'Read',
  argsDigest: 'b'.repeat(64),
  argsShape: { operation: 'read', objectKind: 'path' },
  objectDigest: 'c'.repeat(64),
  startMs: 1000,
  endMs: 1500,
  deltaMs: 200,
  strength: 'confirmed',
  reasons: [],
  ...extra,
});
const result = (extra = {}) => ({
  strength: 'confirmed',
  reasons: ['exact-binding-object-and-interval'],
  candidates: [candidate()],
  ...extra,
});
module.exports = { candidate, result };
