import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createCollector,
  PROTOCOL,
  CAPACITY,
} = require('../../src/main/platform/etw-process-protocol');
const { pins, provider } = require('../../sidecar/etw-process/schema-pins.json');
const generation = '11111111222233334444555555555555';
const event = (id = 1, changes = {}) => ({
  eventId: id,
  eventVersion: id === 1 ? 4 : 2,
  schema: pins.find((p) => p.id === id).fingerprint,
  kind: id === 1 ? 'start' : id === 2 ? 'stop' : 'rundown',
  subjectPid: 42,
  headerPid: 777,
  qpc: '100',
  creationTime100ns: '134000000000000001',
  creationTimeSource: 'payload-CreateTime-FILETIME',
  providerProcessSequenceNumber: '9007199254740993',
  sequenceSource: 'payload-ProcessSequenceNumber',
  processStartKey: null,
  ...changes,
});
const receipt = (changes = {}) => ({
  callbacks: 1,
  admitted: 1,
  unknown: 0,
  dropped: 0,
  providerFailures: 0,
  nativeStopStatus: 0,
  consumerCompleted: true,
  consumerSucceeded: true,
  loss: { nativeEventsLost: 0, nativeBuffersLost: 0 },
  ...changes,
});
const frame = (sequence, type, observation = null, r = null) => ({
  protocol: PROTOCOL,
  version: 1,
  provider,
  generation,
  sequence,
  type,
  observation,
  receipt: r,
});
const finish = (collector, sequence, r = receipt()) => {
  assert.equal(collector.accept(frame(sequence, 'stopping')), true);
  assert.equal(collector.accept(frame(sequence + 1, 'stop', null, r)), true);
  return collector.result();
};
const running = () => {
  const collector = createCollector(generation);
  assert.equal(collector.accept(frame(1, 'begin')), true);
  return collector;
};

test('preserves exact raw birth and sequence; subject PID differs from header', () => {
  const c = running();
  assert.equal(c.accept(frame(2, 'event', event())), true);
  const result = finish(c, 3);
  assert.equal(result.diagnosticComplete, true);
  assert.equal(result.launchAllowed, false);
  assert.equal(result.events[0].subjectPid, 42);
  assert.equal(result.events[0].headerPid, 777);
  assert.equal(result.events[0].creationTime100ns, '134000000000000001');
  assert.equal(result.events[0].providerProcessSequenceNumber, '9007199254740993');
  assert.equal(result.events[0].processStartKey, null);
});

test('admits buffered event after stopping; final sequence alone never proves drain', () => {
  const c = running();
  c.accept(frame(2, 'stopping'));
  assert.equal(c.result().transportDrained, false);
  assert.equal(c.accept(frame(3, 'event', event(2))), true);
  assert.equal(c.result().transportDrained, false);
  assert.equal(c.accept(frame(4, 'stop', null, receipt())), true);
  assert.equal(c.result().transportDrained, true);
});

test('same PID with adjacent FILETIME ticks stays distinct; no cross-event birth filling', () => {
  const c = running();
  c.accept(frame(2, 'event', event()));
  c.accept(
    frame(
      3,
      'event',
      event(1, {
        qpc: '101',
        creationTime100ns: '134000000000000002',
        providerProcessSequenceNumber: '9007199254740994',
      }),
    ),
  );
  c.accept(
    frame(
      4,
      'event',
      event(2, {
        qpc: '102',
        creationTime100ns: null,
        creationTimeSource: null,
        providerProcessSequenceNumber: null,
        sequenceSource: null,
      }),
    ),
  );
  const result = finish(c, 5, receipt({ callbacks: 3, admitted: 3 }));
  assert.equal(result.events[1].creationTime100ns, '134000000000000002');
  assert.equal(result.events[2].creationTime100ns, null);
  assert.equal(result.diagnosticComplete, true); // transport diagnostics do not authenticate identity
});

test('rundown is separately tagged and never synthesized into a start', () => {
  const c = running();
  c.accept(frame(2, 'event', event(15)));
  assert.equal(finish(c, 3).events[0].kind, 'rundown');
  const bad = running();
  assert.equal(bad.accept(frame(2, 'event', event(15, { kind: 'start' }))), false);
});

test('rejects provider protocol, schema, generation, sequence gaps and replay', () => {
  for (const changes of [
    { protocol: 'etw-file' },
    { provider: 'edd08927-9cc4-4e65-b970-c2560fb5c289' },
    { version: 2 },
    { generation: '22222222222222222222222222222222' },
    { sequence: 3 },
    { extra: 'private' },
  ]) {
    const c = running();
    assert.equal(c.accept({ ...frame(2, 'event', event()), ...changes }), false);
    assert.equal(c.result().invalid, 1);
  }
  const c = running();
  c.accept(frame(2, 'event', event()));
  assert.equal(c.accept(frame(2, 'event', event())), false);
  assert.equal(finish(c, 3).diagnosticComplete, false);
});

test('rejects unknown event/version/layout and noncanonical or lossy numeric witnesses', () => {
  const invalid = [
    { eventId: 999 },
    { eventVersion: 3 },
    { schema: '0'.repeat(64) },
    { subjectPid: 0 },
    { headerPid: -1 },
    { subjectPid: 42.5 },
    { creationTime100ns: Number('134000000000000001') },
    { creationTime100ns: '0134000000000000001' },
    { creationTime100ns: '18446744073709551616' },
    { creationTime100ns: '0' },
    { creationTimeSource: 'event-timestamp' },
    { creationTime100ns: null },
    { qpc: '-1' },
    { qpc: '9223372036854775808' },
    { qpc: 100 },
    { providerProcessSequenceNumber: '1e5' },
    { providerProcessSequenceNumber: null },
    { processStartKey: '123' },
    { commandLine: 'private-token' },
    { imageName: 'private-user-path' },
  ];
  for (const changes of invalid) {
    const c = running();
    assert.equal(c.accept(frame(2, 'event', event(1, changes))), false, JSON.stringify(changes));
  }
});

test('unknown payload, local drops and native loss each block diagnostic completeness', () => {
  for (const changes of [
    { callbacks: 2, unknown: 1 },
    { callbacks: 2, dropped: 1 },
    { loss: { nativeEventsLost: 1, nativeBuffersLost: 0 } },
    { loss: { nativeEventsLost: 0, nativeBuffersLost: 1 } },
    { loss: { nativeEventsLost: null, nativeBuffersLost: 0 } },
  ]) {
    const c = running();
    c.accept(frame(2, 'event', event()));
    assert.equal(finish(c, 3, receipt(changes)).diagnosticComplete, false);
  }
});

test('provider/start/stop/consumer failures and absent counts cannot claim drain', () => {
  for (const changes of [
    { providerFailures: 1 },
    { nativeStopStatus: 5 },
    { nativeStopStatus: null },
    { consumerCompleted: false },
    { consumerSucceeded: false },
  ]) {
    const c = running();
    c.accept(frame(2, 'event', event()));
    const result = finish(c, 3, receipt(changes));
    assert.equal(result.transportDrained, false);
    assert.equal(result.diagnosticComplete, false);
  }
  for (const changes of [
    { admitted: 0 },
    { callbacks: 2 },
    { callbacks: -1 },
    { loss: {} },
    { nativeStopStatus: '0' },
  ]) {
    const c = running();
    c.accept(frame(2, 'event', event()));
    c.accept(frame(3, 'stopping'));
    assert.equal(c.accept(frame(4, 'stop', null, receipt(changes))), false);
  }
});

test('detects duplicate observations and QPC reversal without reordering evidence', () => {
  const c = running();
  c.accept(frame(2, 'event', event()));
  c.accept(frame(3, 'event', event()));
  c.accept(frame(4, 'event', event(2, { qpc: '99' })));
  const result = finish(c, 5, receipt({ callbacks: 3, admitted: 3 }));
  assert.equal(result.duplicates, 1);
  assert.equal(result.outOfOrder, 1);
  assert.equal(result.diagnosticComplete, false);
  assert.equal(result.events[2].qpc, '99');
});

test('bounded storage rejects capacity overrun and accepts explicit dropped count', () => {
  const c = running();
  for (let i = 0; i < CAPACITY; i++)
    assert.equal(c.accept(frame(i + 2, 'event', event(1, { qpc: String(i) }))), true);
  assert.equal(c.accept(frame(CAPACITY + 2, 'event', event())), false);
  const result = finish(
    c,
    CAPACITY + 2,
    receipt({ callbacks: CAPACITY + 1, admitted: CAPACITY, dropped: 1 }),
  );
  assert.equal(result.events.length, CAPACITY);
  assert.equal(result.diagnosticComplete, false);
});

test('enforces terminal state and snapshots cannot mutate collector evidence', () => {
  const c = running();
  c.accept(frame(2, 'event', event()));
  const result = finish(c, 3);
  result.events[0].subjectPid = 5;
  result.receipt.loss.nativeEventsLost = 5;
  assert.equal(c.result().events[0].subjectPid, 42);
  assert.equal(c.result().receipt.loss.nativeEventsLost, 0);
  assert.equal(c.accept(frame(5, 'event', event(2))), false);
  assert.equal(c.result().diagnosticComplete, false);
  const bad = running();
  assert.equal(bad.accept(frame(2, 'stop', null, receipt({ callbacks: 0, admitted: 0 }))), false);
});

const fixturePath = process.env.AEGIS_PROCESS_FIXTURE_PATH;
const requireCompiled = process.env.AEGIS_PROCESS_REQUIRE_COMPILED === '1';
test.skipIf(!fixturePath && !requireCompiled)(
  'compiled C# synthetic fixture decodes through the independent Node wire boundary',
  () => {
    assert.ok(fixturePath, 'Qualified local run requires AEGIS_PROCESS_FIXTURE_PATH');
    const frames = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const c = createCollector(generation);
    for (const f of frames) assert.equal(c.accept(f), true);
    const result = c.result();
    assert.equal(result.diagnosticComplete, true);
    assert.deepEqual(
      result.events.map((e) => [e.kind, e.subjectPid, e.creationTime100ns]),
      [
        ['start', 42, '134000000000000001'],
        ['stop', 42, '134000000000000001'],
      ],
    );
    assert.equal(JSON.stringify(result).includes('PRIVATE-USER-PATH'), false);
  },
);
