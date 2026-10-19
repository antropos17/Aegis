'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Independent synthetic evidence; none is collected from a local agent/registry.
const birth = 1792404000000; // 2026-10-19T10:00:00Z
const selection = { sessionId: 'session-local', cwd: '/work', platform: 'posix' };
const processEvidence = { pid: 42, startTime: birth, instanceId: `42:${birth}`, cwd: '/work' };
const verifier = {
  sessionId: 'session-local',
  pid: 42,
  processStartTime: birth,
  cwd: '/work',
  oneToOne: true,
  provenance: 'verified-local-registry',
};
const event = {
  instanceId: processEvidence.instanceId,
  atMs: birth + 1550,
  objectKind: 'path',
  objectValue: '/work/a/../private.env',
};
const timing = { clockSkewMs: 350, missingEndToleranceMs: 1500 };
const sentinels = ['PROMPT', 'ARGUMENT', 'RESPONSE', 'ENV'].map((s) => `REPLAY_${s}_SENTINEL`);

/** Copy the public synthetic corpus and substitute replay-only privacy sentinels.
 * @param {string} [name] Fixture basename.
 * @param {string} [mode] Missing-end or trailing-record degradation.
 * @param {number} [count] Independently identified Claude call pairs.
 * @returns {Buffer} Disposable source bytes.
 * @since v0.19.2
 */
function copiedFixture(name = 'claude', mode, count = 1) {
  let text = fs.readFileSync(path.join(__dirname, `${name}.jsonl`), 'utf8');
  for (const label of ['PROMPT', 'ARGUMENT', 'RESPONSE', 'ENV'])
    text = text.replaceAll(`PRIVATE_${label}`, `REPLAY_${label}_SENTINEL`);
  text = text.replaceAll('call-local', 'call-replay-0');
  if (mode === 'missing-end') text = text.split('\n')[0] + '\n';
  if (count > 1)
    text = Array.from({ length: count }, (_, i) =>
      text.replaceAll('call-replay-0', `call-replay-${i}`),
    ).join('');
  if (mode === 'truncated') text += '{"prompt":"REPLAY_PROMPT_SENTINEL';
  return Buffer.from(text);
}

// Fixed vectors declared independently of parser/correlator/projector output.
const callRefs = [
  '3ded1408ffed01f8265b1286581f5f746d5c9a28fa04888ed192c8a67c6ef035',
  '158b5221df21d1d4167d44dba8e7cb9dcbea0125e8f240bc1d1427def1788236',
  '2ae33dd2e92f722bcf2cfca46ff7e5dd1b468321b60013364ee0eb817da63b4d',
  '834a532b21d4c3034bf226dbe2d762402aee495076f4de8337c8fdc1b5a43716',
  '1f9e89b835714d4043650c2c8b4de3230813275ff384ea54b2e430103efeef62',
  '6d339a2caa78a556efd00b91ebba253d2709f10c490afcd15bca092bfd5ed539',
  '76a28017bb54ab2dedfc9053c612c963d58924eaadcc4666cecd69fd0d97d34f',
  '8ac32a45c4251e12e1b15f76d8a7215e49d72c35d4900c102bbb2bfc8a06a049',
];
function expected({
  status = 'confirmed',
  codes = ['exact-binding-object-and-interval'],
  count = 1,
  missingEnd = false,
  gemini = false,
} = {}) {
  return {
    schemaVersion: 1,
    relation: 'preceded-by',
    strength: status,
    reasons: codes,
    candidateCount: count,
    candidatesTruncated: count > 8,
    ambiguous: count > 1,
    objectMatch: count ? 'matched' : 'unavailable',
    sessionBinding: status === 'confirmed' ? 'confirmed' : 'unavailable',
    candidates: Array.from({ length: Math.min(count, 8) }, (_, i) => ({
      source: gemini ? 'gemini-cli' : 'claude-code',
      sessionRef: gemini
        ? '7fa3c0424faf311410c51d6f56e587b2972493d41f68e958d31709d8ab065e7a'
        : '14a45537cabdb21ff9a7b523be9807a053a37345f7ede1ef0625f01710780ecd',
      callRef: gemini
        ? 'abc783c7869a830689b9e3518fc66660692255fecb95e10afdb1c05a4e45712e'
        : callRefs[i],
      toolName: gemini ? 'read_file' : 'Read',
      argsDigest: gemini
        ? '66c3f689cb701f692afebd1e99e31193fc00df86ee40c86eab5eaf7696107189'
        : '7e2032942c99ed43e2107a9e3eaab7d0db4d950e1689962039353d862a2e70c6',
      argsShape: { operation: 'read', objectKind: 'path' },
      objectDigest: '56df0397212623e7d7396e307e7f19ce00746f6cccaa936d58c2c2102f297454',
      startMs: birth + 1000,
      endMs: missingEnd ? null : birth + 1600,
      deltaMs: 200,
      strength: status,
      reasons: missingEnd ? ['end-time-unavailable'] : [],
    })),
  };
}
const empty = (codes) => expected({ status: 'unattributed', count: 0, codes });
const overlap = ['no-qualifying-tool-call', 'time-overlap-without-object-match'];
const unavailable = ['no-qualifying-tool-call', 'partial-source'];
const cases = [
  { name: 'complete normalized Read with synthetic verified binding/skew', want: expected() },
  {
    name: 'missing measured skew',
    timing: { missingEndToleranceMs: 1500 },
    want: empty(['clock-skew-unavailable']),
  },
  {
    name: 'same interval with wrong object',
    event: { objectValue: '/work/other.env' },
    want: empty(overlap),
  },
  { name: 'time overlap alone', event: { objectValue: null }, want: empty(overlap) },
  ...['source-reported', 'imported-unverified'].map((provenance) => ({
    name: `${provenance} receiver evidence`,
    verifier: { provenance },
    want: expected({ status: 'inferred', codes: ['session-binding-inferred'] }),
  })),
  {
    name: 'Claude missing completion',
    mode: 'missing-end',
    want: expected({
      status: 'inferred',
      missingEnd: true,
      codes: ['end-time-unavailable', 'exact-binding-object-and-interval'],
    }),
  },
  {
    name: 'truncated trailing record',
    mode: 'truncated',
    want: expected({ status: 'inferred', codes: ['partial-source', 'session-binding-inferred'] }),
  },
  ...['changed', 'replaced', 'short-read', 'missing'].map((race) => ({
    name: `reader ${race}`,
    race,
    want: empty(unavailable),
  })),
  {
    name: 'Codex shell supplies no object oracle',
    fixture: 'codex',
    source: 'codex',
    want: empty(overlap),
  },
  {
    name: 'Gemini missing completion stays inferred',
    fixture: 'gemini',
    source: 'gemini-cli',
    want: expected({
      status: 'inferred',
      gemini: true,
      missingEnd: true,
      codes: ['end-time-unavailable', 'exact-binding-object-and-interval'],
    }),
  },
  {
    name: 'ten eligible calls retain total beyond eight displayed candidates',
    count: 10,
    want: expected({
      status: 'inferred',
      count: 10,
      codes: ['ambiguous-tool-calls', 'context-truncated'],
    }),
  },
];
module.exports = {
  selection,
  processEvidence,
  verifier,
  event,
  timing,
  sentinels,
  copiedFixture,
  cases,
};
