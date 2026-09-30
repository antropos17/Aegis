'use strict';

const MAX_REGISTRY_BYTES = 64 * 1024;

/** Read a small Claude session registry within the shared scan byte budget.
 * Oversized, changing, malformed or unreadable metadata contributes no usage.
 * @param {string} file Registry path for the current monitored PID.
 * @param {{statSync:Function, readRange:Function}} source Injectable filesystem.
 * @param {{remaining:number}} budget Remaining bytes for the adapter call.
 * @returns {Object|null} Parsed registry, or unavailable metadata.
 * @since 0.18.0
 */
function readRegistry(file, source, budget) {
  try {
    const size = source.statSync(file).size;
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_REGISTRY_BYTES) return null;
    // One extra byte detects growth after stat without reading the expanded file.
    const requested = size + 1;
    if (budget.remaining < requested) return null;
    budget.remaining -= requested;
    const bytes = source.readRange(file, 0, requested);
    if (!Buffer.isBuffer(bytes) || bytes.length !== size) return null;
    const registry = JSON.parse(bytes.toString('utf8'));
    return registry && typeof registry === 'object' && !Array.isArray(registry) ? registry : null;
  } catch {
    return null;
  }
}

module.exports = { readRegistry, MAX_REGISTRY_BYTES };
