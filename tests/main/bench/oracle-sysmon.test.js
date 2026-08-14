/**
 * @file tests/main/bench/oracle-sysmon.test.js
 * @description The gate on B2.3's Sysmon oracle adapter.
 *
 *   **Every fixture in this file is SYNTHETIC.** The XML below was written by
 *   hand in the shape the Windows Event Log renders an EventRecord in, from
 *   Microsoft's published Sysmon documentation. No Sysmon binary produced it, no
 *   `.evtx` file was fabricated to hold it, and nothing here is evidence about
 *   Windows.
 *
 *   That boundary is the point of the file, so it is worth stating twice in the
 *   two directions it cuts:
 *
 *   - **What these tests DO prove.** Given an EventRecord in the documented
 *     shape, the normalizer produces the record it claims to, refuses what it
 *     claims to refuse, keeps the two timestamp representations apart, treats
 *     `ProcessGuid` as opaque, and accounts for everything that did not become a
 *     record.
 *   - **What they do NOT prove, and cannot.** That a real
 *     `Microsoft-Windows-Sysmon/Operational` channel exists, that `Get-WinEvent`
 *     hands back this shape, that an installed binary accepts
 *     `bench/oracles/sysmon-bench.xml`, or that any field named here is on that
 *     binary's schema. `readChannelXml` is called by nothing in this file. A
 *     green run of this suite is not a claim about EVTX ingestion.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, it, expect, vi } from 'vitest';

import catalogue from '../../../bench/lib/catalogue.js';
import manifest from '../../../bench/lib/manifest.js';
import sysmon from '../../../bench/lib/oracles/sysmon.js';
import run from '../../../bench/run.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

/** @type {string} Window the synthetic records below are stamped inside. */
const WINDOW_START = '2026-08-14T12:00:00.000Z';

/** @type {string} */
const WINDOW_END = '2026-08-14T12:10:00.000Z';

/**
 * Two opaque ProcessGuid strings. They are OPAQUE here as well: nothing in this
 * file decodes them, and the only operation performed on them is `===`.
 * @type {string}
 */
const GUID_A = '{9f1c3a52-0001-68ad-0100-000000000c00}';

/** @type {string} */
const GUID_B = '{9f1c3a52-0002-68ad-0200-000000000c00}';

/**
 * Escape the five XML predefined characters, so a fixture can carry a command
 * line with quotes and ampersands in it the way a real record does.
 * @param {string} value
 * @returns {string}
 */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * One SYNTHETIC EventRecord XML document, in the shape Windows renders.
 * @param {Object} opts
 * @param {number} opts.eventId
 * @param {string} opts.systemTime - `System/TimeCreated@SystemTime`, verbatim.
 * @param {number} [opts.recordId]
 * @param {Object<string, string>} [opts.data] - EventData entries, in order.
 * @param {string|null} [opts.provider] - `null` omits the Provider element.
 * @param {boolean} [opts.omitEventData]
 * @returns {string}
 */
function syntheticEventXml(opts) {
  const entries = Object.entries(opts.data || {})
    .map(([name, value]) => `      <Data Name="${name}">${escapeXml(value)}</Data>`)
    .join('\n');
  const provider =
    opts.provider === null
      ? ''
      : `    <Provider Name="${opts.provider || 'Microsoft-Windows-Sysmon'}" ` +
        `Guid="{5770385f-c22a-43e0-bf4c-06f5698ffbd9}"/>\n`;
  const recordId =
    opts.recordId === undefined ? '' : `    <EventRecordID>${opts.recordId}</EventRecordID>\n`;
  const eventData = opts.omitEventData ? '' : `  <EventData>\n${entries}\n  </EventData>\n`;
  return (
    `<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event">\n` +
    `  <System>\n` +
    provider +
    `    <EventID>${opts.eventId}</EventID>\n` +
    `    <Version>5</Version>\n` +
    `    <Level>4</Level>\n` +
    `    <Task>${opts.eventId}</Task>\n` +
    `    <Opcode>0</Opcode>\n` +
    `    <Keywords>0x8000000000000000</Keywords>\n` +
    `    <TimeCreated SystemTime="${opts.systemTime}"/>\n` +
    recordId +
    `    <Correlation/>\n` +
    `    <Execution ProcessID="4242" ThreadID="8888"/>\n` +
    `    <Channel>Microsoft-Windows-Sysmon/Operational</Channel>\n` +
    `    <Computer>SYNTHETIC-HOST</Computer>\n` +
    `    <Security UserID="S-1-5-18"/>\n` +
    `  </System>\n` +
    eventData +
    `</Event>`
  );
}

/**
 * A SYNTHETIC EID 1 ProcessCreate, with the field names Microsoft's schema
 * example and documentation use.
 * @param {Object} over
 * @returns {string}
 */
function processCreateXml(over = {}) {
  return syntheticEventXml({
    eventId: 1,
    systemTime: over.systemTime || '2026-08-14T12:01:00.1234567Z',
    recordId: over.recordId === undefined ? 1001 : over.recordId,
    data: {
      RuleName: 'bench-run-dir',
      UtcTime: '2026-08-14 12:01:00.121',
      ProcessGuid: over.processGuid || GUID_A,
      ProcessId: String(over.processId === undefined ? 7788 : over.processId),
      Image: 'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\R1\\stage\\claude.exe',
      CommandLine: '"X:\\...\\stage\\claude.exe" -n 600 127.0.0.1',
      CurrentDirectory: 'X:\\Future\\ESCAPE\\AEGIS\\',
      Hashes: 'SHA256=3F786850E387550FDAB836ED7E6DC881DE23001B',
      ParentProcessGuid: '{9f1c3a52-9999-68ad-0900-000000000c00}',
      ParentProcessId: '4242',
      ParentImage: 'C:\\Program Files\\nodejs\\node.exe',
      ParentCommandLine: 'node bench/run.js --scenario S1-agent-lifecycle --arm B',
      ...(over.data || {}),
    },
  });
}

/**
 * A SYNTHETIC EID 5 ProcessTerminate. Microsoft's prose gives this event
 * `UtcTime`, `ProcessGuid` and `ProcessId`; `Image` is included here only where a
 * test is about a record that exposes it.
 * @param {Object} over
 * @returns {string}
 */
function processTerminateXml(over = {}) {
  return syntheticEventXml({
    eventId: 5,
    systemTime: over.systemTime || '2026-08-14T12:02:00.7654321Z',
    recordId: over.recordId === undefined ? 1002 : over.recordId,
    data: {
      RuleName: '-',
      UtcTime: '2026-08-14 12:02:00.764',
      ProcessGuid: over.processGuid || GUID_A,
      ProcessId: String(over.processId === undefined ? 7788 : over.processId),
      ...(over.data || {}),
    },
  });
}

/**
 * Normalize a set of SYNTHETIC documents inside the standard window.
 * @param {string[]} documents
 * @returns {{events: Object[], tally: Object}}
 */
function normalize(documents) {
  return sysmon.select({
    documents,
    scenario: 'S1-agent-lifecycle',
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
  });
}

/**
 * A reader that returns SYNTHETIC documents, standing in for the live boundary.
 * @param {string[]} documents
 * @returns {function(): Object}
 */
function injectedReader(documents) {
  return () => ({
    documents,
    capReached: false,
    command: 'INJECTED SYNTHETIC READER — no channel was read',
  });
}

/* ------------------------------------------------------------------ 1, 15 --- */

describe('sysmon oracle — ProcessCreate normalization', () => {
  it('produces one process.start record carrying only what EID 1 exposed', () => {
    const { events, tally } = normalize([processCreateXml()]);

    expect(tally.read).toBe(1);
    expect(tally.normalized).toBe(1);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.event.category).toEqual(['process']);
    expect(event.event.type).toEqual(['start']);
    expect(event.event.action).toBe(catalogue.EVENT_SHAPES['process.start'].action);
    expect(event.event.code).toBe('1');
    expect(event.event.provider).toBe('Microsoft-Windows-Sysmon');
    expect(event.event.sequence).toBe(1001);
    expect(event.ecs.version).toBe(catalogue.ECS_VERSION);

    expect(event.process.pid).toBe(7788);
    expect(event.process.executable).toBe(
      'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\R1\\stage\\claude.exe',
    );
    expect(event.process.name).toBe('claude.exe');
    expect(event.process.command_line).toBe('"X:\\...\\stage\\claude.exe" -n 600 127.0.0.1');
    expect(event.process.parent).toEqual({
      pid: 4242,
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      name: 'node.exe',
      command_line: 'node bench/run.js --scenario S1-agent-lifecycle --arm B',
    });

    expect(event.bench.source).toBe('sysmon-eventlog-xml');
    expect(event.bench.oracle).toBe('sysmon');
    expect(event.bench.eventId).toBe(1);
    expect(event.bench.ruleName).toBe('bench-run-dir');
    expect(event.bench.scenario).toBe('S1-agent-lifecycle');
  });

  // The catalogue's convention, and the reason it exists: an omitted field says
  // "nobody observed this", a null says "it was observed to be nothing".
  it('omits a field the record did not expose rather than nulling it', () => {
    const bare = syntheticEventXml({
      eventId: 1,
      systemTime: '2026-08-14T12:01:00.0000000Z',
      recordId: 1,
      data: {
        UtcTime: '2026-08-14 12:01:00.000',
        ProcessGuid: GUID_A,
        ProcessId: '7788',
      },
    });
    const { events } = normalize([bare]);

    expect(events).toHaveLength(1);
    expect(events[0].process).toEqual({ pid: 7788 });
    expect('executable' in events[0].process).toBe(false);
    expect('name' in events[0].process).toBe(false);
    expect('command_line' in events[0].process).toBe(false);
    expect('parent' in events[0].process).toBe(false);
    expect('ruleName' in events[0].bench).toBe(false);
    expect(JSON.stringify(events[0])).not.toContain('null');
  });
});

/* ---------------------------------------------------------------------- 2 --- */

describe('sysmon oracle — ProcessTerminate normalization', () => {
  it('produces a process.end record with no exit code and no invented image', () => {
    const { events } = normalize([processTerminateXml()]);

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.event.category).toEqual(['process']);
    expect(event.event.type).toEqual(['end']);
    expect(event.event.code).toBe('5');
    expect(event.process).toEqual({ pid: 7788 });
    // Sysmon's process-terminate event has no exit code and no signal. Neither is
    // invented, and neither is borrowed from anywhere else.
    expect('exit_code' in event.process).toBe(false);
    expect('executable' in event.process).toBe(false);
    expect('name' in event.process).toBe(false);
  });

  it('keeps Image when the record exposed one, because that is an observation', () => {
    const withImage = processTerminateXml({
      data: { Image: 'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\R1\\stage\\claude.exe' },
    });
    const { events } = normalize([withImage]);

    expect(events[0].process.executable).toBe(
      'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\R1\\stage\\claude.exe',
    );
    expect(events[0].process.name).toBe('claude.exe');
  });

  // The failure this forbids is the tempting one: EID 1 has a command line and a
  // parent, EID 5 shares its ProcessGuid, and merging them would produce a record
  // that reads as if Sysmon had observed a command line at termination.
  it('never copies EID 1 fields into an EID 5 record', () => {
    const { events } = normalize([processCreateXml(), processTerminateXml()]);

    const terminate = events.find((e) => e.event.code === '5');
    expect(terminate.process).toEqual({ pid: 7788 });
    expect('command_line' in terminate.process).toBe(false);
    expect('parent' in terminate.process).toBe(false);
    expect('parentProcessGuid' in terminate.bench).toBe(false);
    expect(JSON.stringify(terminate)).not.toContain('600');
  });
});

/* ------------------------------------------------------------------- 3, 4 --- */

describe('sysmon oracle — lifecycle correlation by opaque ProcessGuid', () => {
  it('pairs a terminate to the create that shares its guid', () => {
    const { events } = normalize([processCreateXml(), processTerminateXml()]);
    const lifecycle = sysmon.correlateLifecycle(events);

    expect(lifecycle.creations).toBe(1);
    expect(lifecycle.terminations).toBe(1);
    expect(lifecycle.paired).toEqual([
      { createOrdinality: 0, terminateOrdinality: 0, processGuid: GUID_A, processId: 7788 },
    ]);
    expect(lifecycle.unpaired).toEqual([]);
    expect(lifecycle.ambiguous).toEqual([]);
    expect(lifecycle.key).toMatch(/never parsed/);
    expect(lifecycle.key).toMatch(/never transformed into an AEGIS instanceId/);
  });

  // The load-bearing case. Two generations reuse one pid; only the guid separates
  // them. A pairing that fell back to pid would cross the generations and report a
  // lifecycle the OS never had.
  it('keeps two generations apart when they share a pid and differ only by guid', () => {
    const documents = [
      processCreateXml({ processGuid: GUID_A, processId: 7788, recordId: 2001 }),
      processCreateXml({
        processGuid: GUID_B,
        processId: 7788,
        recordId: 2002,
        systemTime: '2026-08-14T12:03:00.1000000Z',
      }),
      processTerminateXml({
        processGuid: GUID_B,
        processId: 7788,
        recordId: 2003,
        systemTime: '2026-08-14T12:04:00.1000000Z',
      }),
    ];
    const { events } = normalize(documents);
    const lifecycle = sysmon.correlateLifecycle(events);

    expect(lifecycle.creations).toBe(2);
    expect(lifecycle.distinctPidsAcrossCreations).toBe(1);
    expect(lifecycle.pidsReusedAcrossCreations).toEqual([7788]);

    // Exactly one pairing, and it is to the SECOND creation — the one whose guid
    // the terminate carries — not to the first, which shares the pid.
    expect(lifecycle.paired).toHaveLength(1);
    expect(lifecycle.paired[0].createOrdinality).toBe(1);
    expect(lifecycle.paired[0].processGuid).toBe(GUID_B);
    expect(lifecycle.unpaired).toEqual([]);
  });

  it('reports a terminate with no matching create as UNPAIRED, never paired by pid', () => {
    const { events } = normalize([
      processCreateXml({ processGuid: GUID_A, processId: 7788 }),
      processTerminateXml({ processGuid: GUID_B, processId: 7788, recordId: 3003 }),
    ]);
    const lifecycle = sysmon.correlateLifecycle(events);

    expect(lifecycle.paired).toEqual([]);
    expect(lifecycle.unpaired).toHaveLength(1);
    expect(lifecycle.unpaired[0].processGuid).toBe(GUID_B);
    expect(lifecycle.unpaired[0].reason).toMatch(/never paired by pid instead/);
  });

  it('reports two creates sharing one guid as AMBIGUOUS rather than guessing', () => {
    const { events } = normalize([
      processCreateXml({ processGuid: GUID_A, processId: 7788, recordId: 4001 }),
      processCreateXml({
        processGuid: GUID_A,
        processId: 9999,
        recordId: 4002,
        systemTime: '2026-08-14T12:03:00.1000000Z',
      }),
      processTerminateXml({ processGuid: GUID_A, recordId: 4003 }),
    ]);
    const lifecycle = sysmon.correlateLifecycle(events);

    expect(lifecycle.paired).toEqual([]);
    expect(lifecycle.ambiguous).toHaveLength(1);
    expect(lifecycle.ambiguous[0].creationOrdinalities).toEqual([0, 1]);
    expect(lifecycle.ambiguous[0].reason).toMatch(/AMBIGUOUS/);
  });
});

/* ------------------------------------------------------------------- 5, 6 --- */

describe('sysmon oracle — ProcessGuid stays opaque', () => {
  it('carries the guid verbatim and derives nothing from its contents', () => {
    const { events } = normalize([processCreateXml()]);
    const event = events[0];

    expect(event.bench.processGuid).toBe(GUID_A);
    // Nothing anywhere in the record is a substring or a transform of the guid's
    // interior. The two timestamp fields come from the event's own timestamps,
    // and the pid from ProcessId — none of them from the guid.
    expect(event['@timestamp']).toBe('2026-08-14T12:01:00.123Z');
    expect(event.bench.utcTime).toBe('2026-08-14 12:01:00.121');
    expect(event.process.pid).toBe(7788);
  });

  // A guid whose interior is nonsense must normalize exactly like a well-formed
  // one: if any code path read meaning out of those bytes, this would diverge.
  it('normalizes a structurally meaningless guid identically to a plausible one', () => {
    const nonsense = '{zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz}';
    const plausible = normalize([processCreateXml({ processGuid: GUID_A })]).events[0];
    const opaque = normalize([processCreateXml({ processGuid: nonsense })]).events[0];

    expect(opaque.bench.processGuid).toBe(nonsense);
    expect({ ...opaque.bench, processGuid: null }).toEqual({
      ...plausible.bench,
      processGuid: null,
    });
    expect(opaque['@timestamp']).toBe(plausible['@timestamp']);
    expect(opaque.process).toEqual(plausible.process);
  });

  // `instanceId` is `"<pid>:<startTimeMs>"` (src/main/process-identity.js). No
  // record this oracle writes may hold that key, under any name: manufacturing an
  // AEGIS identity out of a Sysmon guid would make the oracle a second opinion on
  // AEGIS's own identity scheme instead of an independent observation.
  it('never manufactures an AEGIS instanceId out of a Sysmon guid', () => {
    const { events } = normalize([processCreateXml(), processTerminateXml()]);

    for (const event of events) {
      const serialized = JSON.stringify(event);
      expect(serialized).not.toMatch(/instanceId/i);
      expect(serialized).not.toMatch(/"7788:\d+"/);
      expect(Object.keys(event.bench)).not.toContain('instanceId');
    }
  });
});

/* ---------------------------------------------------------------- 7, 8, 9 --- */

describe('sysmon oracle — file events', () => {
  /**
   * @param {number} eventId - 11, 23 or 26.
   * @param {Object} over
   * @returns {string}
   */
  function fileEventXml(eventId, over = {}) {
    return syntheticEventXml({
      eventId,
      systemTime: over.systemTime || '2026-08-14T12:05:00.5000000Z',
      recordId: over.recordId === undefined ? 5001 : over.recordId,
      data: {
        RuleName: 'bench-run-dir',
        UtcTime: '2026-08-14 12:05:00.499',
        ProcessGuid: GUID_A,
        ProcessId: '4242',
        Image: 'C:\\Program Files\\nodejs\\node.exe',
        TargetFilename: 'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\R1\\stage\\claude.exe',
        ...(over.data || {}),
      },
    });
  }

  it('normalizes EID 11 FileCreate as file.creation and keeps it distinct', () => {
    const { events } = normalize([
      fileEventXml(11, { data: { CreationUtcTime: '2026-08-14 12:05:00.498' } }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].event.code).toBe('11');
    expect(events[0].event.category).toEqual(['file']);
    expect(events[0].event.type).toEqual(['creation']);
    expect(events[0].event.action).toBe(catalogue.EVENT_SHAPES['file.creation'].action);
    expect(events[0].file).toEqual({
      path: 'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\R1\\stage\\claude.exe',
      name: 'claude.exe',
      directory: 'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\R1\\stage',
    });
    // Sysmon's own creation timestamp, kept verbatim in its own format and never
    // parsed into an instant.
    expect(events[0].bench.creationUtcTime).toBe('2026-08-14 12:05:00.498');
  });

  it('normalizes EID 26 FileDeleteDetected as the canonical deletion observation', () => {
    const { events, tally } = normalize([fileEventXml(26, { data: { Archived: 'false' } })]);

    expect(events).toHaveLength(1);
    expect(events[0].event.code).toBe('26');
    expect(events[0].event.category).toEqual(['file']);
    expect(events[0].event.type).toEqual(['deletion']);
    expect(events[0].bench.archived).toBe('false');
    expect(tally.archivalDeletes).toEqual([]);
    expect(sysmon.SHAPED_EVENT_IDS[26]).toBe('file.deletion');
    expect(sysmon.CANONICAL_EVENT_IDS).toContain(26);
  });

  // The ratification this pins: 23 archives the file it reports deleted, 26 does
  // not, and the two are never one semantic event. A 23 is not a deletion record
  // here — it is the finding that the running configuration is not ours.
  it('refuses EID 23 FileDelete as a deletion and records it as an archival finding', () => {
    const { events, tally } = normalize([fileEventXml(23, { recordId: 5023 })]);

    expect(events).toEqual([]);
    expect(tally.normalized).toBe(0);
    expect(tally.archivalDeletes).toHaveLength(1);
    expect(tally.archivalDeletes[0].eventRecordId).toBe(5023);
    expect(tally.archivalDeletes[0].reason).toMatch(/NOT accepted as a deletion observation/);
    expect(tally.archivalDeletes[0].reason).toMatch(/ArchiveDirectory/);
    expect(sysmon.SHAPED_EVENT_IDS[23]).toBeUndefined();
    expect(sysmon.CANONICAL_EVENT_IDS).not.toContain(23);
  });

  it('keeps 23 and 26 apart when both arrive, rather than collapsing them', () => {
    const { events, tally } = normalize([
      fileEventXml(26, { recordId: 6026 }),
      fileEventXml(23, { recordId: 6023, systemTime: '2026-08-14T12:06:00.0000000Z' }),
    ]);

    expect(events).toHaveLength(1);
    expect(events.map((e) => e.event.code)).toEqual(['26']);
    expect(tally.archivalDeletes.map((a) => a.eventRecordId)).toEqual([6023]);
  });
});

/* --------------------------------------------------------------------- 10 --- */

describe('sysmon oracle — canonical events with no shape in the subset', () => {
  it('counts EID 2, 3 and 22 rather than writing them, and claims no network coverage', () => {
    const network = syntheticEventXml({
      eventId: 3,
      systemTime: '2026-08-14T12:07:00.0000000Z',
      recordId: 7003,
      data: {
        RuleName: 'bench-run-dir',
        UtcTime: '2026-08-14 12:07:00.000',
        ProcessGuid: GUID_A,
        ProcessId: '7788',
        Image: 'X:\\...\\stage\\claude.exe',
        DestinationIp: '127.0.0.1',
        DestinationPort: '443',
      },
    });
    const dns = syntheticEventXml({
      eventId: 22,
      systemTime: '2026-08-14T12:07:01.0000000Z',
      recordId: 7022,
      data: {
        UtcTime: '2026-08-14 12:07:01.000',
        ProcessGuid: GUID_A,
        ProcessId: '7788',
        QueryName: 'example.invalid',
      },
    });
    const fileTime = syntheticEventXml({
      eventId: 2,
      systemTime: '2026-08-14T12:07:02.0000000Z',
      recordId: 7002,
      data: {
        UtcTime: '2026-08-14 12:07:02.000',
        ProcessGuid: GUID_A,
        ProcessId: '7788',
        TargetFilename: 'X:\\...\\stage\\claude.exe',
      },
    });

    const { events, tally } = normalize([network, dns, fileTime]);

    expect(events).toEqual([]);
    expect(tally.read).toBe(3);
    expect(tally.normalized).toBe(0);
    expect(tally.shapelessByEventId).toEqual({ 2: 1, 3: 1, 22: 1 });
    // Not refused, not lost: real observations the catalogue's four shapes have
    // no room for. They must not land in any refusal bucket.
    expect(tally.refused.unsupportedEventId).toEqual({});
    expect(tally.refused.malformed).toEqual([]);
  });

  it('puts an event id outside the canonical set in unsupportedEventId', () => {
    const imageLoad = syntheticEventXml({
      eventId: 7,
      systemTime: '2026-08-14T12:07:03.0000000Z',
      recordId: 7007,
      data: { UtcTime: '2026-08-14 12:07:03.000', ProcessGuid: GUID_A, ProcessId: '7788' },
    });
    const { events, tally } = normalize([imageLoad]);

    expect(events).toEqual([]);
    expect(tally.refused.unsupportedEventId).toEqual({ 7: 1 });
    expect(tally.shapelessByEventId).toEqual({});
  });
});

/* --------------------------------------------------------------------- 11 --- */

describe('sysmon oracle — malformed and incomplete records are explicit', () => {
  it('refuses a document that is not an event record, naming why', () => {
    const { events, tally } = normalize(['', 'not xml at all', '<Event></Event>']);

    expect(events).toEqual([]);
    expect(tally.read).toBe(3);
    expect(tally.refused.malformed).toHaveLength(3);
    expect(tally.refused.malformed[0].reason).toMatch(/it is empty/);
    expect(tally.refused.malformed[1].reason).toMatch(/no <Event> element/);
    expect(tally.refused.malformed[2].reason).toMatch(/no <System> block/);
    expect(tally.refused.malformed.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it('refuses a shaped record missing a required EventData field', () => {
    const noGuid = syntheticEventXml({
      eventId: 1,
      systemTime: '2026-08-14T12:01:00.0000000Z',
      recordId: 8001,
      data: { UtcTime: '2026-08-14 12:01:00.000', ProcessId: '7788' },
    });
    const noTarget = syntheticEventXml({
      eventId: 26,
      systemTime: '2026-08-14T12:01:01.0000000Z',
      recordId: 8026,
      data: { UtcTime: '2026-08-14 12:01:01.000', ProcessGuid: GUID_A, ProcessId: '7788' },
    });
    const { events, tally } = normalize([noGuid, noTarget]);

    expect(events).toEqual([]);
    expect(tally.refused.missingRequiredField).toHaveLength(2);
    expect(tally.refused.missingRequiredField[0].reason).toMatch(/carries no "ProcessGuid"/);
    expect(tally.refused.missingRequiredField[0].reason).toMatch(/no value is substituted/);
    expect(tally.refused.missingRequiredField[1].reason).toMatch(/carries no "TargetFilename"/);
  });

  it('refuses two Data entries of one name instead of picking one', () => {
    const ambiguous = processCreateXml().replace(
      '<Data Name="ProcessId">7788</Data>',
      '<Data Name="ProcessId">7788</Data>\n      <Data Name="ProcessId">9999</Data>',
    );
    const { tally } = normalize([ambiguous]);

    expect(tally.refused.malformed).toHaveLength(1);
    expect(tally.refused.malformed[0].reason).toMatch(/two <Data Name="ProcessId"> entries/);
  });

  it('refuses a record from another provider rather than reading it as oracle evidence', () => {
    const foreign = syntheticEventXml({
      eventId: 1,
      systemTime: '2026-08-14T12:01:00.0000000Z',
      recordId: 9001,
      provider: 'Microsoft-Windows-Security-Auditing',
      data: { UtcTime: '2026-08-14 12:01:00.000', ProcessGuid: GUID_A, ProcessId: '7788' },
    });
    const { events, tally } = normalize([foreign]);

    expect(events).toEqual([]);
    expect(tally.refused.foreignProvider).toEqual([
      { index: 0, eventId: 1, provider: 'Microsoft-Windows-Security-Auditing' },
    ]);
  });

  it('decodes XML entities rather than storing their escaped form', () => {
    const escaped = processCreateXml({
      data: { CommandLine: '"c.exe" --a <b> & \'c\'' },
    });
    const { events } = normalize([escaped]);

    expect(events[0].process.command_line).toBe('"c.exe" --a <b> & \'c\'');
    expect(sysmon.decodeXmlText('&amp;lt;')).toBe('&lt;');
    expect(sysmon.decodeXmlText('&#x41;&#66;')).toBe('AB');
  });
});

/* ----------------------------------------------------------- 12, 15 -------- */

describe('sysmon oracle — the two timestamps are never mixed', () => {
  it('takes @timestamp from SystemTime and truncates, never rounds', () => {
    expect(sysmon.normalizeSystemTime('2026-08-14T12:00:00.9999999Z')).toBe(
      '2026-08-14T12:00:00.999Z',
    );
    expect(sysmon.normalizeSystemTime('2026-08-14T12:00:00.1234567Z')).toBe(
      '2026-08-14T12:00:00.123Z',
    );
    expect(sysmon.normalizeSystemTime('2026-08-14T12:00:00Z')).toBe('2026-08-14T12:00:00.000Z');
    expect(sysmon.normalizeSystemTime('2026-08-14T12:00:00.5Z')).toBe('2026-08-14T12:00:00.500Z');
    // The catalogue's own instant format, so all three NDJSON files agree.
    expect(
      catalogue.ISO_UTC_MS.test(sysmon.normalizeSystemTime('2026-08-14T12:00:00.9999999Z')),
    ).toBe(true);
  });

  // The four-hour trap, stated as a refusal. `Get-WinEvent`'s `TimeCreated`
  // property is a .NET DateTime with Kind=Local; if a future reader ever hands
  // local instants over instead of the XML's SystemTime, this fails at the first
  // record instead of producing a plausible latency figure.
  it('REFUSES a non-UTC instant instead of applying its offset', () => {
    expect(() => sysmon.normalizeSystemTime('2026-08-14T08:00:00.0000000-04:00')).toThrow(
      /not a UTC instant ending in Z/,
    );
    expect(() => sysmon.normalizeSystemTime('2026-08-14T08:00:00.0000000')).toThrow(/UTC instant/);
    expect(() => sysmon.normalizeSystemTime('8/14/2026 8:00:00 AM')).toThrow(/UTC instant/);

    const local = syntheticEventXml({
      eventId: 1,
      systemTime: '2026-08-14T08:01:00.1234567-04:00',
      recordId: 1,
      data: { UtcTime: '2026-08-14 12:01:00.121', ProcessGuid: GUID_A, ProcessId: '7788' },
    });
    const { events, tally } = normalize([local]);

    expect(events).toEqual([]);
    expect(tally.refused.nonUtcTimestamp).toHaveLength(1);
    expect(tally.refused.nonUtcTimestamp[0].reason).toMatch(/turns its own clock into/);
    // And above all: no record was produced whose instant was shifted by four
    // hours into the window.
    expect(tally.normalized).toBe(0);
  });

  // RAW is not overwritten by NORMALIZED. Both representations survive, labelled,
  // and no arithmetic is ever done between them.
  it('keeps both representations, and computes no delta between them', () => {
    const { events } = normalize([processCreateXml()]);
    const event = events[0];

    expect(event['@timestamp']).toBe('2026-08-14T12:01:00.123Z');
    expect(event.bench.timeCreatedSystemTime).toBe('2026-08-14T12:01:00.1234567Z');
    expect(event.bench.utcTime).toBe('2026-08-14 12:01:00.121');

    // No field anywhere holds the difference, and none is an epsilon: this module
    // declares no timestamp tolerance at all. B2.5 owns matching, and the ~2 s
    // figure in RESEARCH-BASELINE section 10 is about comparing two Sysmon
    // representations — not about guest-clock uncertainty, which is unmeasured.
    const serialized = JSON.stringify(event);
    expect(serialized).not.toMatch(/epsilon/i);
    expect(serialized).not.toMatch(/latency/i);
    expect(serialized).not.toMatch(/skew/i);
    expect(Object.keys(sysmon)).not.toContain('EPSILON_MS');
    expect(
      sysmon.buildLoss({
        runId: 'r',
        scenario: 's',
        arm: 'B',
        window: { start: WINDOW_START, end: WINDOW_END },
        config: { configPath: 'p', configSha256: 'x' },
        tally: null,
        collection: { ran: false, reader: 'none', unavailable: 'none' },
      }).collection.windowEpsilonMs,
    ).toBe(0);
  });

  it('does not modify the raw documents it was handed', () => {
    const documents = [processCreateXml(), processTerminateXml(), 'garbage'];
    const before = JSON.parse(JSON.stringify(documents));
    normalize(documents);

    expect(documents).toEqual(before);
  });

  it('drops a record outside the window instead of widening the window to reach it', () => {
    const early = processCreateXml({ systemTime: '2026-08-14T11:59:59.9990000Z' });
    const late = processCreateXml({ systemTime: '2026-08-14T12:10:00.0010000Z' });
    const { events, tally } = normalize([early, late]);

    expect(events).toEqual([]);
    expect(tally.outOfWindow).toBe(2);
  });
});

/* ----------------------------------------------------------------- 13, 14 --- */

describe('sysmon oracle — the manifest block', () => {
  it('digests the exact bytes of the config file it names', () => {
    const block = sysmon.manifestBlock();

    expect(block.configPath).toBe('bench/oracles/sysmon-bench.xml');
    const bytes = fs.readFileSync(path.join(REPO, block.configPath));
    expect(block.configSha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));

    // Not the path, not the decoded text with some other newline convention, and
    // not a committed constant: `.gitattributes` puts this file under
    // `text=auto`, so a hard-coded digest would go red on a checkout with other
    // line endings while naming exactly the same configuration.
    expect(block.configSha256).not.toBe(
      crypto.createHash('sha256').update(block.configPath).digest('hex'),
    );
    expect(block.configSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('digests a different config to a different value', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-sysmon-cfg-'));
    try {
      const other = path.join(dir, 'other.xml');
      fs.writeFileSync(other, '<Sysmon schemaversion="4.82"><EventFiltering/></Sysmon>', 'utf8');
      const block = sysmon.manifestBlock({ configPath: other });

      expect(block.configSha256).not.toBe(sysmon.manifestBlock().configSha256);
      expect(block.configSha256).toBe(
        crypto.createHash('sha256').update(fs.readFileSync(other)).digest('hex'),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // No version reaches a manifest from this suite, from a web page, or from a
  // default. A version is a fact about an installed binary, and no binary is
  // installed here.
  it('records no Sysmon version offline, and says why instead', () => {
    expect(sysmon.manifestBlock().version).toBeNull();
    expect(sysmon.manifestBlock().unavailable).toMatch(/no Sysmon version was probed/);

    const probed = sysmon.probeVersion({
      exec: () => {
        throw new Error('no Sysmon or Sysmon64 service is installed on this host');
      },
    });
    expect(probed.value).toBeNull();
    // The reason depends on the platform, and BOTH branches are pinned rather
    // than the assertion being loosened to whichever one this runner takes. The
    // bench is Windows-only and CI runs on ubuntu-latest, so the non-Windows
    // branch is the one the required `test` context actually executes — and a
    // Windows fact on another platform must be absent WITH A REASON, never a
    // bare "probe produced no value".
    if (process.platform === 'win32') {
      expect(probed.unavailable).toMatch(/no Sysmon or Sysmon64 service is installed/);
    } else {
      expect(probed.unavailable).toMatch(/this is not a Windows host/);
      expect(probed.unavailable).toMatch(/Sysmon is a Windows facility/);
    }
    expect(probed.unavailable).not.toMatch(/^probe produced no value$/);

    const block = sysmon.manifestBlock({ version: probed });
    expect(block.version).toBeNull();
    expect(block.configSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(block.unavailable).toMatch(/not measured under a Sysmon binary/);
    expect(block.unavailable).toMatch(/not evidence it was applied/);
  });

  it('records a version only when a probe actually produced one', () => {
    const block = sysmon.manifestBlock({
      version: {
        value: {
          service: 'Sysmon64',
          image: 'C:\\Windows\\Sysmon64.exe',
          // Unmistakably synthetic: no released Sysmon carries this version.
          fileVersion: '0.0.0-SYNTHETIC-TEST-ONLY',
          productVersion: '0.0.0-SYNTHETIC-TEST-ONLY',
        },
        source: 'injected',
      },
    });

    expect(block.version).toBe('0.0.0-SYNTHETIC-TEST-ONLY');
    expect(block.unavailable).toBeUndefined();
    expect(Object.keys(block).sort()).toEqual(['configPath', 'configSha256', 'version']);
  });

  it('keeps the reserved three-field contract and adds nothing to it', () => {
    expect(Object.keys(sysmon.manifestBlock()).sort()).toEqual([
      'configPath',
      'configSha256',
      'unavailable',
      'version',
    ]);
  });
});

/* --------------------------------------------------------------------- 16 --- */

describe('sysmon oracle — loss accounting claims nothing it cannot establish', () => {
  /**
   * @param {string[]} documents
   * @returns {Object}
   */
  function collectWith(documents) {
    return sysmon.collect({
      runId: 'R1',
      scenario: 'S1-agent-lifecycle',
      arm: 'B',
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      config: sysmon.manifestBlock(),
      read: injectedReader(documents),
    });
  }

  it('never reports channel retention as zero, only as unmeasured', () => {
    const { loss } = collectWith([processCreateXml(), processTerminateXml()]);

    expect(loss.channelRetention.value).toBeNull();
    expect(loss.channelRetention.unavailable).toMatch(/not measured/);
    expect(loss.channelRetention.unavailable).toMatch(/Absent, not zero/);
  });

  it('says a filtered-out record is not a lost one, and that it cannot count them', () => {
    const { loss } = collectWith([processCreateXml()]);

    expect(loss.config.filterAccounting).toMatch(/no filter-hit counter/);
    expect(loss.config.filterAccounting).toMatch(/neither is reported as loss/);
    expect(loss.config.enabledEventIds).toEqual([1, 2, 3, 5, 11, 22, 26]);
    expect(loss.config.enabledEventIds).not.toContain(23);
    expect(loss.config.archivalEventId).toBe(23);
    expect(loss.config.sha256).toBe(sysmon.manifestBlock().configSha256);
  });

  it('reports EventRecordID gaps without calling them loss', () => {
    const { loss } = collectWith([
      processCreateXml({ recordId: 100 }),
      processTerminateXml({ recordId: 104 }),
    ]);

    expect(loss.eventRecordIds.collected).toBe(2);
    expect(loss.eventRecordIds.first).toBe(100);
    expect(loss.eventRecordIds.last).toBe(104);
    expect(loss.eventRecordIds.gaps).toEqual([{ after: 100, before: 104, missing: 3 }]);
    expect(loss.eventRecordIds.meaning).toMatch(/a gap is NOT a loss count/);
    expect(loss.eventRecordIds.meaning).toMatch(/caused by a working filter/);
  });

  it('reports EID 255 as its own signal rather than folding it into another count', () => {
    const error255 = syntheticEventXml({
      eventId: 255,
      systemTime: '2026-08-14T12:08:00.0000000Z',
      recordId: 255255,
      data: { UtcTime: '2026-08-14 12:08:00.000', ID: 'RuleEngine', Description: 'synthetic' },
    });
    const { loss } = collectWith([error255]);

    expect(loss.sysmonErrors.count).toBe(1);
    expect(loss.sysmonErrors.records[0].description).toBe('synthetic');
    expect(loss.sysmonErrors.meaning).toMatch(/real loss signal/);
    expect(loss.records.normalized).toBe(0);
    expect(loss.refused.unsupportedEventId).toEqual({});
  });

  it('states that its window carries no epsilon, and why none was invented', () => {
    const { loss } = collectWith([processCreateXml()]);

    expect(loss.collection.windowEpsilonMs).toBe(0);
    expect(loss.collection.window).toEqual({ start: WINDOW_START, end: WINDOW_END });
    expect(loss.collection.windowBasis).toMatch(/No epsilon is applied and none is declared/);
    expect(loss.collection.windowBasis).toMatch(/nothing in this repository has measured/);
  });

  it('writes the accounting when nothing was collected, and no records file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-sysmon-run-'));
    try {
      const failing = () => {
        throw new sysmon.SysmonError('reader-failed', 'no channel on this host');
      };
      const result = sysmon.collect({
        runId: 'R1',
        scenario: 'S1-agent-lifecycle',
        arm: 'B',
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        config: sysmon.manifestBlock(),
        read: failing,
      });

      expect(result.ok).toBe(false);
      expect(result.events).toEqual([]);
      expect(result.loss.collection.ran).toBe(false);
      expect(result.loss.collection.unavailable).toMatch(/no channel on this host/);
      // Absent, not zero: with no read there is nothing to account for, and the
      // counters are not written as zeroes that would read as a clean collection.
      expect(result.loss.records).toEqual({
        value: null,
        unavailable: 'no read ran, so there is nothing to account for',
      });
      expect(result.loss.refused).toBeNull();
      expect(result.loss.eventRecordIds).toBeNull();
      expect(result.loss.lifecycle).toBeNull();

      sysmon.writeLoss(dir, result.loss);
      expect(fs.readdirSync(dir)).toEqual([sysmon.LOSS_FILENAME]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // `runOracle` closes its own window at the moment it is called, which is the
  // live behaviour and not something to stub out — so the synthetic records here
  // are stamped in the past rather than at this file's usual window, and the run
  // instant is the one thing this test lets the clock decide.
  it('writes both artefacts through run.js, in the shapes the harness reads', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-sysmon-run-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const result = run.runOracle({
        dir,
        runId: 'R1',
        scenario: 'S1-agent-lifecycle',
        arm: 'B',
        startedAt: '2026-08-01T00:00:00.000Z',
        config: sysmon.manifestBlock(),
        read: injectedReader([
          processCreateXml({ systemTime: '2026-08-01T12:01:00.1234567Z' }),
          processTerminateXml({ systemTime: '2026-08-01T12:02:00.7654321Z' }),
        ]),
      });

      expect(result.ok).toBe(true);
      expect(fs.readdirSync(dir).sort()).toEqual(
        [sysmon.LOSS_FILENAME, sysmon.ORACLE_FILENAME].sort(),
      );
      const ndjson = fs.readFileSync(path.join(dir, sysmon.ORACLE_FILENAME), 'utf8');
      expect(ndjson).toBe(catalogue.serialize(result.events));
      expect(ndjson.endsWith('\n')).toBe(true);
      expect(
        ndjson
          .trimEnd()
          .split('\n')
          .map((l) => JSON.parse(l).event.code),
      ).toEqual(['1', '5']);

      const loss = JSON.parse(fs.readFileSync(path.join(dir, sysmon.LOSS_FILENAME), 'utf8'));
      expect(loss.schemaVersion).toBe(sysmon.LOSS_SCHEMA_VERSION);
      expect(loss.oracle).toBe('sysmon');
      expect(loss.arm).toBe('B');
      expect(loss.records.read).toBe(2);
      expect(loss.records.normalized).toBe(2);
      expect(loss.lifecycle.paired).toHaveLength(1);
    } finally {
      log.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes no records file when the read ran but normalized nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-sysmon-run-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      run.runOracle({
        dir,
        runId: 'R1',
        scenario: 'S1-agent-lifecycle',
        arm: 'B',
        startedAt: WINDOW_START,
        config: sysmon.manifestBlock(),
        read: injectedReader(['garbage']),
      });

      expect(fs.readdirSync(dir)).toEqual([sysmon.LOSS_FILENAME]);
    } finally {
      log.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* --------------------------------------------------------------------- 17 --- */

describe('sysmon oracle — arm B is a PARTIAL calibration and says so', () => {
  it('leaves procmon unavailable in the manifest when sysmon is supplied', () => {
    const oracles = manifest.oraclePlaceholders({ sysmon: sysmon.manifestBlock() });

    expect(oracles.sysmon.configPath).toBe('bench/oracles/sysmon-bench.xml');
    expect(oracles.procmon.version).toBeNull();
    expect(oracles.procmon.unavailable).toMatch(/sub-block B2\.6/);
  });

  // The arm's own definition is the other half of the statement: B is Sysmon AND
  // Procmon, so an unavailable procmon entry is the run saying which of the two
  // columns it produced.
  it('keeps arm B defined as Sysmon and Procmon, so the gap is legible', () => {
    expect(manifest.ARM_DESCRIPTIONS.B).toMatch(/Sysmon \+ Procmon/);
    expect(manifest.ARM_DESCRIPTIONS.B).toMatch(/oracle calibration/);
  });

  // `run.js` sweeps `host`, `sensor` and `oracles` for `unavailable` entries and
  // prints them at the end of a run. This is the condition that sweep tests, so a
  // B run states the missing Procmon column at the moment of measurement.
  it('exposes the limitation as an absent fact the run prints', () => {
    const record = {
      host: {},
      sensor: {},
      oracles: manifest.oraclePlaceholders({ sysmon: sysmon.manifestBlock() }),
    };
    const absent = [];
    for (const [group, fields] of Object.entries(record)) {
      for (const [name, entry] of Object.entries(fields)) {
        if (entry && entry.unavailable) absent.push(`${group}.${name}: ${entry.unavailable}`);
      }
    }

    expect(absent.some((line) => line.startsWith('oracles.procmon:'))).toBe(true);
    expect(absent.join('\n')).toMatch(/B2\.6/);
  });

  it('runs an oracle in arms A and B, and none in C', () => {
    expect(run.ORACLE_ARMS).toEqual(['A', 'B']);
    expect(run.ORACLE_ARMS).not.toContain('C');
    expect(manifest.oraclePlaceholders().sysmon.unavailable).toMatch(/not run for this arm/);
  });
});

/* ------------------------------------------------- the boundary, restated --- */

describe('sysmon oracle — every record names the acquisition boundary that exists', () => {
  // `bench.source` is provenance, and it rides on every single normalized record.
  // The implemented boundary is the Event Log channel read through `Get-WinEvent`
  // and rendered by `EventRecord.ToXml()`. Nothing here opens, exports or ingests
  // an `.evtx` file, so no record may carry a label that says it did — that would
  // put a claim about a file format where a later reader takes it for evidence
  // (memory-bank/ai-mistakes.md #27: write the guarantee, not the impression).
  it('labels the source as the Event Log XML boundary, never as EVTX', () => {
    expect(sysmon.SOURCE).toBe('sysmon-eventlog-xml');
    expect(sysmon.SOURCE).toMatch(/eventlog/);
    expect(sysmon.SOURCE).toMatch(/xml/);
    expect(sysmon.SOURCE).not.toMatch(/evtx/i);
    // The `<source>-<form>` kebab-case the harness already speaks, next to
    // `aegis-audit` and `derived-model`.
    expect(sysmon.SOURCE).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/);
  });

  it('carries that label on every normalized record, whatever the event', () => {
    const documents = [
      processCreateXml(),
      processTerminateXml(),
      syntheticEventXml({
        eventId: 11,
        systemTime: '2026-08-14T12:05:00.0000000Z',
        recordId: 5011,
        data: {
          UtcTime: '2026-08-14 12:05:00.000',
          ProcessGuid: GUID_A,
          ProcessId: '4242',
          TargetFilename: 'X:\\...\\stage\\claude.exe',
        },
      }),
      syntheticEventXml({
        eventId: 26,
        systemTime: '2026-08-14T12:06:00.0000000Z',
        recordId: 5026,
        data: {
          UtcTime: '2026-08-14 12:06:00.000',
          ProcessGuid: GUID_A,
          ProcessId: '4242',
          TargetFilename: 'X:\\...\\stage\\claude.exe',
        },
      }),
    ];
    const { events } = normalize(documents);

    expect(events).toHaveLength(4);
    for (const event of events) {
      expect(event.bench.source).toBe('sysmon-eventlog-xml');
      // No record claims EVTX provenance anywhere in it — not in the source
      // label, not in the channel, not in a leftover field.
      expect(JSON.stringify(event)).not.toMatch(/evtx/i);
    }
  });

  it('does not claim EVTX provenance anywhere in the loss accounting either', () => {
    const { loss } = sysmon.collect({
      runId: 'R1',
      scenario: 'S1-agent-lifecycle',
      arm: 'B',
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      config: sysmon.manifestBlock(),
      read: injectedReader([processCreateXml()]),
    });

    expect(JSON.stringify(loss)).not.toMatch(/evtx/i);
    expect(loss.collection.channel).toBe('Microsoft-Windows-Sysmon/Operational');
  });
});

describe('sysmon oracle — the live boundary is untested and says so', () => {
  it('keeps the raw channel read behind one injectable function', () => {
    expect(typeof sysmon.readChannelXml).toBe('function');
    // Nothing in this suite calls it. Named here only so the contract that it is
    // the single crossing point is pinned rather than assumed.
    expect(sysmon.CHANNEL).toBe('Microsoft-Windows-Sysmon/Operational');
    expect(sysmon.PROVIDER).toBe('Microsoft-Windows-Sysmon');
  });

  it('ships a config that has never been offered to a Sysmon binary, and says so', () => {
    const xml = fs.readFileSync(path.join(REPO, 'bench/oracles/sysmon-bench.xml'), 'utf8');

    expect(xml).toMatch(/NOT YET ACCEPTED BY A SYSMON BINARY/);
    expect(xml).toMatch(/schemaversion="4\.82"/);
    expect(xml).toMatch(/<FileDeleteDetected onmatch="include">/);
    // EID 23 is not enabled anywhere: the only occurrences of FileDelete in this
    // file are in the prose explaining why it is absent.
    expect(xml).not.toMatch(/<FileDelete\b/);
    expect(xml).toMatch(/LIVE-UNVALIDATED/);
  });
});
