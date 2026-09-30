import { createHash } from 'node:crypto';

const positives = [
  'allow-filesystem',
  'allow-api',
  'replay',
  'reconnect',
  'cancel-after-dispatch',
  'lost-response',
  'known-secret-response',
];
const unknown = ['cancel-after-dispatch', 'lost-response', 'known-secret-response'];

/** Compare actual receiver observations with fixed, independent workflow expectations.
 * Client errors never establish zero effects; the disposable receiver supplies that evidence.
 * @param {string} mode Fixed workflow scenario.
 * @param {object} evidence Observed counts/bytes and gateway response classification.
 * @returns {object} Secret-free, non-authorizing qualification receipt. @since v0.17.0 */
export function summarizeMcpWorkflow(
  mode,
  { observed, returnedResult, alternateRequests, replayRefused, durableConsumed },
) {
  const expected = positives.includes(mode) ? 1 : 0;
  const expectedBytes =
    mode === 'allow-api' ? Buffer.from([0x45]) : Buffer.from('dummy-byte-effect');
  const state = returnedResult ? 'completed' : expected ? 'outcome-unknown' : 'refused';
  const expectedState = unknown.includes(mode)
    ? 'outcome-unknown'
    : expected
      ? 'completed'
      : 'refused';
  const approvedBytesMatch = expected
    ? Buffer.isBuffer(observed.approved) && observed.approved.equals(expectedBytes)
    : observed.approved === null;
  const passed =
    observed.deliveries === expected &&
    observed.effects === expected &&
    observed.forbidden === 0 &&
    observed.errors === 0 &&
    observed.forbiddenBytes === null &&
    approvedBytesMatch &&
    alternateRequests === 0 &&
    state === expectedState &&
    replayRefused !== false &&
    (!expected || durableConsumed);
  return {
    schemaVersion: 1,
    developerOnly: true,
    launchAllowed: false,
    mode,
    passed,
    state,
    deliveries: observed.deliveries,
    effects: observed.effects,
    forbiddenDeliveries: observed.forbidden,
    approvedBytesMatch,
    forbiddenBytesAbsent: observed.forbiddenBytes === null,
    alternateRequests,
    approvedSha256: observed.approved
      ? createHash('sha256').update(observed.approved).digest('hex')
      : null,
    requests: observed.requests,
    replayRefused,
    durableConsumed,
    receiverErrors: observed.errors,
    realIdentityQualified: false,
    serverContainmentQualified: false,
  };
}
