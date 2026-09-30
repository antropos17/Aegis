'use strict';

const { randomUUID } = require('node:crypto');
const { readResultReviewBundle, describeResultReviewBundle } = require('./result-review-bundle');

/** Validate path-free renderer result import, status and retention-clear operations.
 * @param {object} request Structured renderer options. @returns {boolean} Exact bounded shape. @since v0.17.0 */
function validResultReviewRequest(request) {
  if (!request || Object.getPrototypeOf(request) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(request);
  if (request.action === 'review-result') return keys.length === 1 && keys[0] === 'action';
  return (
    ['result-status', 'clear-result'].includes(request.action) &&
    keys.length === 2 &&
    keys.includes('action') &&
    keys.includes('id') &&
    typeof request.id === 'string' &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(request.id)
  );
}

/** Execute an operation only inside the existing serialized native-dialog ownership seam.
 * @param {object} context Main-owned session, revision, selection and ownership guard.
 * @returns {Promise<object>} Bounded comparison metadata; no payload, selected absolute path or imported authority. @since v0.17.0 */
async function handleResultReview(context) {
  const { session, request, revision, pick, assertOwned } = context;
  assertOwned();
  if (request.action === 'review-result') {
    const file = await pick('Select the imported result comparison bundle');
    assertOwned();
    const comparison = await (context.readBundle || readResultReviewBundle)(file, assertOwned);
    assertOwned();
    const result = Object.freeze({
      id: randomUUID(),
      revision,
      createdAt: new Date().toISOString(),
      comparison: describeResultReviewBundle(comparison),
    });
    session.resultRetained = { report: result, review: comparison };
    return { success: true, result };
  }
  const result = session.resultRetained?.report;
  if (!result || result.id !== request.id || result.revision !== revision)
    return { success: false, error: 'result-review-expired' };
  if (request.action === 'clear-result') {
    session.resultRetained = null;
    return { success: true, cleared: true, id: result.id };
  }
  return { success: true, result };
}
module.exports = { validResultReviewRequest, handleResultReview };
