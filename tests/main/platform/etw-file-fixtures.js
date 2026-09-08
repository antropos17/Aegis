// Synthetic contract vectors. No machine paths, command lines or live capture.
export function telemetry(overrides = {}) {
  return {
    operational: true,
    reasons: [],
    counters: {
      eventsLost: '0',
      realTimeBuffersLost: '0',
      logBuffersLost: '0',
      queryStatus: 0,
      asOfQpc: '100',
    },
    totals: {
      delivered: '10',
      filtered: '2',
      dropped: '0',
      decoderErrors: '0',
      mapEpoch: '0',
      mapResets: '0',
      mapConflicts: '0',
    },
    queues: { records: 0, bytes: 0, highWaterRecords: 2, highWaterBytes: 1024 },
    coverage: 'home-26200-diagnostic-v1',
    ...overrides,
  };
}

export function observation(overrides = {}) {
  return {
    eventSeq: '1',
    provider: 'edd08927-9cc4-4e65-b970-c2560fb5c289',
    eventId: 15,
    version: 1,
    qpc: '9007199254740993',
    headerPid: 71,
    headerTid: 72,
    issuingTid: 73,
    payloadTid: null,
    path: null,
    pathEvidence: 'unresolved',
    issuerStatus: 'candidate',
    generationStatus: 'unresolved',
    generationWitness: null,
    generationSource: null,
    generationInterval: null,
    agent: null,
    instanceId: null,
    ...overrides,
  };
}

export function message(t = 'hello', seq = '1', data) {
  const payloads = {
    hello: {
      build: 'offline-fixture',
      profile: 'home-26200-diagnostic-v1',
      schemas: ['10:0', '12:1', '13:1', '14:1', '15:1'],
    },
    start: { requestId: 'start-1', profile: 'home-26200-diagnostic-v1', buffersMiB: 16 },
    ready: {
      requestId: 'start-1',
      frequency: '10000000',
      clock: { qpc: '100', unixMs: '1788883200000', uncertaintyQpc: '1' },
      buffers: { count: 256, sizeKiB: 64 },
      telemetry: telemetry(),
    },
    observations: { records: [observation()] },
    health: telemetry(),
    heartbeat: telemetry(),
    stop: { requestId: 'stop-1' },
    stopped: {
      requestId: 'stop-1',
      drained: true,
      stopped: true,
      finalEventSeq: '1',
      telemetry: telemetry(),
    },
    error: { requestId: null, code: 'session-failed' },
  };
  return {
    t,
    proto: 'etw-file/1',
    launchId: 'launch-1',
    sessionId: 'session-1',
    seq,
    data: data ?? payloads[t],
  };
}

// Deliberately bypass production encoding so invalid input can reach the reader.
export function rawFrame(value) {
  const body = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(body.length);
  return Buffer.concat([prefix, body]);
}
