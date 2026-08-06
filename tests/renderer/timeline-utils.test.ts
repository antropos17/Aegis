/**
 * timeline-utils.test.ts — Event Schema v1 fields on the timeline read path.
 *
 * The audit read path (`audit-logger.getEntriesBefore` → `normalizeAuditEntry`) hands the
 * renderer `schemaVersion`, `instanceId` and `attribution`. Before v1 those were dropped by
 * the local `AuditEntry` type here. These tests pin that they survive the whole way to the
 * object the tooltip reads, and that a pre-v1 entry still produces exactly what it used to.
 */
import { describe, it, expect } from 'vitest';
import {
  auditToTimelineEvent,
  buildClusters,
  formatAttribution,
  UNKNOWN_SOURCE_LABEL,
} from '../../src/renderer/lib/utils/timeline-utils.ts';

/** Identity projection — buildClusters only needs a number back. */
const tsToX = (ts: number) => ts;

/**
 * A timeline event sitting at the same x as its siblings, so buildClusters groups them.
 * Everything the test does not care about is left at a fixed value.
 */
function clusterable(over: Record<string, unknown>) {
  return { timestamp: 1_000_000, sensitive: true, _type: 'file', agent: 'A', ...over };
}

const V1_FILE_ENTRY = {
  schemaVersion: 1,
  timestamp: '2026-08-04T09:00:00.000Z',
  type: 'file-access',
  agent: 'Cursor',
  instanceId: '4242:1780000000000',
  action: 'read',
  path: '/home/user/.bashrc',
  severity: 'sensitive',
  attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
} as const;

/**
 * A record written before Event Schema v1 and read back through `normalizeAuditEntry`,
 * which adds `attribution: null` for a record that never had one and leaves
 * `schemaVersion` absent — the absence IS how a v0 record is identified.
 */
const V0_FILE_ENTRY = {
  timestamp: '2026-07-30T09:00:00.000Z',
  type: 'file-access',
  agent: 'legacy',
  action: 'read',
  path: '/tmp/old',
  severity: 'normal',
};

describe('auditToTimelineEvent — Event Schema v1 fields survive', () => {
  it('keeps schemaVersion, instanceId and attribution on a file event', () => {
    const ev = auditToTimelineEvent(V1_FILE_ENTRY);

    expect(ev.schemaVersion).toBe(1);
    expect(ev.instanceId).toBe('4242:1780000000000');
    expect(ev.attribution).toEqual({ status: 'confirmed', evidence: ['handle-scan-pid'] });
    // The pre-v1 fields are untouched — this change is additive.
    expect(ev.agent).toBe('Cursor');
    expect(ev.action).toBe('read');
    expect(ev.file).toBe('/home/user/.bashrc');
    expect(ev.sensitive).toBe(true);
    expect(ev._type).toBe('file');
    expect(ev._historical).toBe(true);
  });

  it('keeps them on a network event too', () => {
    const ev = auditToTimelineEvent({
      schemaVersion: 1,
      timestamp: '2026-08-04T09:00:01.000Z',
      type: 'network-connection',
      agent: 'claude',
      instanceId: '77:1780000000001',
      severity: 'high',
      attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
    } as const);

    expect(ev.schemaVersion).toBe(1);
    expect(ev.instanceId).toBe('77:1780000000001');
    expect(ev.attribution).toEqual({ status: 'confirmed', evidence: ['os-tcp-owner-pid'] });
    expect(ev._type).toBe('network');
    expect(ev.flagged).toBe(true);
  });

  it('carries all three through buildClusters to the dot the tooltip reads', () => {
    const [dot] = buildClusters([auditToTimelineEvent(V1_FILE_ENTRY)], tsToX);

    expect(dot.count).toBe(1);
    expect(dot.schemaVersion).toBe(1);
    expect(dot.instanceId).toBe('4242:1780000000000');
    expect(dot.attribution).toEqual({ status: 'confirmed', evidence: ['handle-scan-pid'] });
  });

  it('drops identity on a multi-event cluster, exactly as pid already does', () => {
    // Two events close enough in x to cluster. Identity is per-event: presenting one
    // event's instanceId as the group's would claim a process the others never ran in.
    const [dot] = buildClusters(
      [
        clusterable({ agent: 'A', instanceId: 'a:1' }),
        clusterable({ agent: 'B', instanceId: 'b:1' }),
      ],
      tsToX,
    );

    expect(dot.count).toBe(2);
    expect(dot.pid).toBeNull();
    expect(dot.schemaVersion).toBeUndefined();
    expect(dot.instanceId).toBeUndefined();
  });
});

describe('clusterAttribution', () => {
  it('keeps an unattributed status when every event in the cluster agrees', () => {
    // Without this, an unresolved owner vanishes behind an "N events" label the moment a
    // second event lands within CLUSTER_PX of it — the silence C-01 exists to prevent.
    const [dot] = buildClusters(
      [
        clusterable({ attribution: { status: 'unattributed', evidence: ['no-owner-match'] } }),
        clusterable({ attribution: { status: 'unattributed', evidence: ['no-ai-agents-online'] } }),
      ],
      tsToX,
    );

    expect(dot.count).toBe(2);
    expect(dot.attribution).toEqual({ status: 'unattributed', evidence: null });
    expect(formatAttribution(dot.attribution)).toBe('Unknown source');
  });

  it('drops the evidence for a cluster even when the status survives', () => {
    // The two events were confirmed by different codes. `null` says the group's evidence
    // was never a single thing — it is not a claim that no evidence existed.
    const [dot] = buildClusters(
      [
        clusterable({ attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] } }),
        clusterable({ attribution: { status: 'confirmed', evidence: ['rm-holder-pid'] } }),
      ],
      tsToX,
    );

    expect(dot.attribution).toEqual({ status: 'confirmed', evidence: null });
    expect(formatAttribution(dot.attribution)).toBe('confirmed');
  });

  it('drops the attribution when the cluster disagrees', () => {
    const [dot] = buildClusters(
      [
        clusterable({ attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] } }),
        clusterable({ attribution: { status: 'inferred', evidence: ['cwd-containment'] } }),
      ],
      tsToX,
    );

    expect(dot.attribution).toBeUndefined();
    expect(formatAttribution(dot.attribution)).toBe('');
  });

  it('drops the attribution when one event in the cluster has none', () => {
    // A pre-v1 event in the group means the group's status is not a fact about all of it.
    const [dot] = buildClusters(
      [
        clusterable({ attribution: { status: 'unattributed', evidence: ['no-owner-match'] } }),
        clusterable({}),
      ],
      tsToX,
    );

    expect(dot.attribution).toBeUndefined();
  });
});

describe('auditToTimelineEvent — pre-v1 entries are unchanged', () => {
  it('produces the same event object it produced before v1 existed', () => {
    const ev = auditToTimelineEvent(V0_FILE_ENTRY);

    expect(ev).toEqual({
      agent: 'legacy',
      timestamp: new Date('2026-07-30T09:00:00.000Z').getTime(),
      action: 'read',
      file: '/tmp/old',
      sensitive: false,
      _denied: false,
      _type: 'file',
      _historical: true,
    });
  });

  it('never invents a schemaVersion, instanceId or attribution', () => {
    const ev = auditToTimelineEvent(V0_FILE_ENTRY);

    // Absence is the signal that identifies a v0 record. Defaulting any of these would
    // assert something the record never said.
    expect(ev.schemaVersion).toBeUndefined();
    expect(ev.instanceId).toBeUndefined();
    expect(ev.attribution).toBeUndefined();
  });

  it('renders no attribution text, so the tooltip keeps its pre-v1 shape', () => {
    const [dot] = buildClusters([auditToTimelineEvent(V0_FILE_ENTRY)], tsToX);

    expect(formatAttribution(dot.attribution)).toBe('');
  });

  it('survives a normalized v0 record whose attribution is explicitly null', () => {
    // `normalizeAuditEntry` returns `attribution: null` for a record that never had one.
    const ev = auditToTimelineEvent({ ...V0_FILE_ENTRY, attribution: null });

    expect(ev.attribution).toBeNull();
    expect(formatAttribution(ev.attribution)).toBe('');
  });
});

describe('formatAttribution', () => {
  it('renders an unattributed event as the literal "Unknown source"', () => {
    const text = formatAttribution({ status: 'unattributed', evidence: ['no-owner-match'] });

    expect(text).toBe('Unknown source');
    expect(UNKNOWN_SOURCE_LABEL).toBe('Unknown source');
    // The status word itself is never shown for this case, and no name stands in for the
    // owner that was not resolved (C-01).
    expect(text).not.toContain('unattributed');
    expect(text).not.toContain('no-owner-match');
  });

  it('shows the evidence codes behind a confirmed event', () => {
    expect(formatAttribution({ status: 'confirmed', evidence: ['handle-scan-pid'] })).toBe(
      'confirmed via handle-scan-pid',
    );
    expect(
      formatAttribution({ status: 'confirmed', evidence: ['rm-holder-pid', 'os-tcp-owner-pid'] }),
    ).toBe('confirmed via rm-holder-pid, os-tcp-owner-pid');
  });

  it('shows the evidence codes behind an inferred event', () => {
    expect(formatAttribution({ status: 'inferred', evidence: ['self-config-path'] })).toBe(
      'inferred via self-config-path',
    );
  });

  it('carries no number, score or percentage', () => {
    for (const attribution of [
      { status: 'confirmed', evidence: ['handle-scan-pid', 'rm-holder-pid'] },
      { status: 'inferred', evidence: ['cwd-containment'] },
      { status: 'unattributed', evidence: ['no-owner-match'] },
    ] as const) {
      const text = formatAttribution(attribution);
      expect(text).not.toMatch(/[0-9]/);
      expect(text).not.toContain('%');
    }
  });

  it('reports the bare status when the evidence was never recorded', () => {
    // A normalized v0 record: `evidence: null` means "never written down", which is a
    // different claim from `[]` — so nothing is listed rather than an empty list shown.
    expect(formatAttribution({ status: 'confirmed', evidence: null })).toBe('confirmed');
    expect(formatAttribution({ status: 'inferred', evidence: [] })).toBe('inferred');
  });

  it('returns empty for anything with nothing to say', () => {
    expect(formatAttribution(null)).toBe('');
    expect(formatAttribution(undefined)).toBe('');
    expect(formatAttribution({} as never)).toBe('');
  });

  it('shows nothing for a status outside the closed union', () => {
    // The union is enforced on the write path, so a status the renderer does not recognise
    // came off disk malformed. It is not put in front of the user.
    expect(formatAttribution({ status: 'probably', evidence: [] } as never)).toBe('');
    expect(formatAttribution({ status: 42, evidence: null } as never)).toBe('');
  });

  it('ignores evidence entries that are not codes', () => {
    expect(
      formatAttribution({ status: 'confirmed', evidence: [{}, 'handle-scan-pid'] } as never),
    ).toBe('confirmed via handle-scan-pid');
    expect(formatAttribution({ status: 'confirmed', evidence: [{}] } as never)).toBe('confirmed');
  });
});
