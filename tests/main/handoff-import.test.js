import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { importHandoffEvents, LIMITS } = require('../../src/main/handoff-import');
let root;
let file;
const event = (extra = {}) => ({
  hook_event_name: 'SubagentStart',
  session_id: 'PRIVATE_SESSION',
  agent_id: 'PRIVATE_AGENT',
  ...extra,
});
const jsonl = (values) => values.map((value) => JSON.stringify(value) + '\n').join('');
async function run(content) {
  fs.writeFileSync(file, content);
  return importHandoffEvents('claude-code', file);
}
const codes = (report) => report.diagnostics.map((d) => d.code);
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-handoff-'));
  file = path.join(root, 'PRIVATE_INPUT.jsonl');
});
afterEach(() => {
  vi.restoreAllMocks();
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('unverified lifecycle import', () => {
  it('retains repeated starts and stops without inventing a process, delivery or ownership', async () => {
    const report = await run(jsonl([event(), event(), event({ hook_event_name: 'SubagentStop' })]));
    expect(report).toMatchObject({
      complete: true,
      completenessScope: 'selected-input-processing',
      provenance: 'imported-unverified',
      processBinding: 'unbound',
      transferEvidence: 'unobserved',
      activityCoverage: 'unknown',
      adapter: { producerVersion: 'unknown' },
      counts: { accepted: 3, rejected: 0, unsupported: 0, diagnostics: 0 },
      usage: { records: 3, identities: 2 },
    });
    expect(report.events.map((e) => [e.kind, e.record])).toEqual([
      ['subagent-start', 1],
      ['subagent-start', 2],
      ['subagent-stop', 3],
    ]);
    expect(new Set(report.events.map((e) => e.agentRef)).size).toBe(1);
    expect(report.events[0]).toMatchObject({
      schemaVersion: 1,
      sourceId: report.sourceId,
      phase: 'observation',
      sourceAuthentication: 'none',
      decision: 'not-applicable',
      control: 'not-supported',
    });
    expect(report.receiver).toMatchObject({
      state: 'closed',
      accepted: 3,
      lossDetected: false,
      receiptScope: 'receiver-intake-only',
      activityCoverage: 'unknown',
    });
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  });

  it('separates equal agent IDs across sessions and imports', async () => {
    const content = jsonl([event(), event({ session_id: 'second' }), event()]);
    const a = await run(content);
    const b = await run(content);
    expect(a.events[0].agentRef).toBe(a.events[2].agentRef);
    expect(a.events[0].agentRef).not.toBe(a.events[1].agentRef);
    expect(a.events[0].sessionRef).not.toBe(a.events[1].sessionRef);
    expect(a.sourceId).not.toBe(b.sourceId);
    expect(a.events[0].agentRef).not.toBe(b.events[0].agentRef);
  });

  it('drops canaries, forged evidence and executable/path references without opening them', async () => {
    const content = jsonl([
      event({
        agent_type: 'PRIVATE_TYPE',
        transcript_path: 'PRIVATE_TRANSCRIPT',
        agent_transcript_path: 'PRIVATE_SUBAGENT',
        last_assistant_message: 'PRIVATE_OUTPUT',
        tool_input: { command: 'PRIVATE_COMMAND' },
        env: { key: 'PRIVATE_KEY' },
        pid: 666,
        instanceId: 'PRIVATE_PROCESS',
        startTime: 123,
        timestamp: 'PRIVATE_TIME',
        verified: true,
        provenance: 'verified',
        processBinding: 'confirmed',
        transferEvidence: 'observed',
        severity: 'critical',
        schemaVersion: 900,
        prompt: 'PRIVATE_PROMPT',
        content: { nested: 'PRIVATE_CONTENT' },
      }),
    ]);
    fs.writeFileSync(file, content);
    const open = vi.spyOn(fs.promises, 'open');
    const report = await importHandoffEvents('claude-code', file);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(fs.realpathSync(file));
    // A generated source UUID may contain the digits 666; check the rejected
    // input field itself rather than an unrelated substring in an opaque ID.
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|"pid":666|critical/);
    expect(report).toMatchObject({
      schemaVersion: 2,
      processBinding: 'unbound',
      transferEvidence: 'unobserved',
    });
  });

  it('counts unsupported, malformed and incomplete records with fixed diagnostics', async () => {
    const report = await run(
      jsonl([event({ hook_event_name: 'PRIVATE_UNKNOWN' })]) +
        '{PRIVATE_BROKEN\n' +
        jsonl([null, [], {}, event({ agent_id: null })]) +
        JSON.stringify(event()),
    );
    expect(report.counts).toMatchObject({ accepted: 0, rejected: 5, unsupported: 1 });
    expect(report.complete).toBe(false);
    expect(codes(report)).toContain('unterminated-record');
    expect(report.receiver).toMatchObject({ state: 'closed', lossDetected: true, accepted: 0 });
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  });

  it.each(['', 'x\u0000', 'x\u007f', 'x\u0085', '\ud800', 'é'.repeat(129), 'x'.repeat(257)])(
    'rejects invalid identifier %j without echo',
    async (agent_id) => {
      const report = await run(jsonl([event({ agent_id })]));
      expect(report.counts.rejected).toBe(1);
      expect(codes(report)).toEqual(['invalid-identifier']);
    },
  );

  it('accepts identifiers on the UTF-8 byte boundary, including non-BMP text', async () => {
    const report = await run(
      jsonl([event({ agent_id: 'é'.repeat(128), session_id: '😀'.repeat(64) })]),
    );
    expect(report.complete).toBe(true);
    expect(report.counts.accepted).toBe(1);
  });

  it('rejects invalid UTF-8 instead of merging replacement-character identifiers', async () => {
    const bad = Buffer.concat([
      Buffer.from('{"hook_event_name":"SubagentStart","session_id":"s","agent_id":"'),
      Buffer.from([0xff]),
      Buffer.from('"}\n'),
    ]);
    const report = await run(bad);
    expect(codes(report)).toEqual(['invalid-json-record']);
  });

  it('handles a valid line across chunks and rejects oversized lines without losing the next record', async () => {
    const base = JSON.stringify(event({ ignored: '' }));
    const bounded = JSON.stringify(
      event({ ignored: 'x'.repeat(LIMITS.lineBytes - Buffer.byteLength(base)) }),
    );
    const report = await run(bounded + '\n' + bounded + ' \n' + jsonl([event()]));
    expect(report.events.map((e) => e.record)).toEqual([1, 3]);
    expect(report.counts.rejected).toBe(1);
    expect(codes(report)).toEqual(['line-size-limit']);
    expect(report.usage.bytes).toBe(
      Buffer.byteLength(bounded) * 2 + 3 + Buffer.byteLength(jsonl([event()])),
    );
  });

  it('accepts empty input and CRLF without claiming agent coverage', async () => {
    const empty = await run('');
    expect(empty).toMatchObject({ complete: true, activityCoverage: 'unknown', events: [] });
    const crlf = await run(JSON.stringify(event()) + '\r\n');
    expect(crlf.counts.accepted).toBe(1);
  });

  it('caps diagnostics while preserving error totals', async () => {
    const report = await run('{PRIVATE\n'.repeat(40));
    expect(report.diagnostics).toHaveLength(32);
    expect(report.counts).toMatchObject({ rejected: 40, diagnostics: 40 });
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  });

  it('allows exactly the event cap and exposes truncation only when more input exists', async () => {
    const body = jsonl(Array.from({ length: LIMITS.events }, () => event()));
    expect((await run(body)).complete).toBe(true);
    const limited = await run(body + jsonl([event()]));
    expect(limited.events).toHaveLength(LIMITS.events);
    expect(codes(limited)).toEqual(['event-limit']);
  });

  it('bounds record processing even if no event is accepted', async () => {
    const report = await run('null\n'.repeat(LIMITS.records + 1));
    expect(report.usage.records).toBe(LIMITS.records);
    expect(report.counts.rejected).toBe(LIMITS.records);
    expect(report.counts.diagnostics).toBe(LIMITS.records + 1);
    expect(report.complete).toBe(false);
  });

  it('bounds combined scoped identities before admitting an extra event', async () => {
    const report = await run(
      jsonl(Array.from({ length: 1001 }, (_, i) => event({ session_id: `s${i}` }))),
    );
    expect(report.usage.identities).toBe(2000);
    expect(report.events).toHaveLength(1000);
    expect(codes(report)).toEqual(['identity-limit']);
  });

  it('rejects an oversized file before opening it', async () => {
    fs.writeFileSync(file, '');
    fs.truncateSync(file, LIMITS.fileBytes + 1);
    const open = vi.spyOn(fs.promises, 'open');
    const report = await importHandoffEvents('claude-code', file);
    expect(open).not.toHaveBeenCalled();
    expect(report).toMatchObject({ complete: false, inputAvailable: false, usage: { bytes: 0 } });
    expect(codes(report)).toEqual(['file-size-limit']);
    expect(report.receiver).toMatchObject({ state: 'closed', lastSequence: 0, lossDetected: true });
  });

  it('rejects an unsupported adapter before reading', async () => {
    const open = vi.spyOn(fs.promises, 'open');
    await expect(importHandoffEvents('PRIVATE_ADAPTER', file)).rejects.toThrow(
      'handoff-adapter-unsupported',
    );
    expect(open).not.toHaveBeenCalled();
  });
});
