import { vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const fixture = Buffer.from('local-inert-record');
export const selected = 'X:\\owned\\selected.jsonl';
export const selection = { sessionId: 'local', cwd: '/work', platform: 'posix' };
export const options = { assets: {}, requestMs: 1000, sessionMs: 10000, cleanupMs: 1000 };
export const state = {
  kind: 'regular',
  symlink: false,
  reparse: false,
  volumeId: '0000000000000001',
  fileId: '00000000000000000000000000000002',
  size: fixture.length,
  mtimeNs: '100',
  ctimeNs: '200',
};

function load(file, overrides) {
  const saved = new Map();
  for (const [name, exports] of Object.entries(overrides)) {
    const id = require.resolve(name);
    saved.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  }
  const id = require.resolve(file);
  delete require.cache[id];
  try {
    return require(file);
  } finally {
    delete require.cache[id];
    for (const [key, value] of saved) {
      if (value) require.cache[key] = value;
      else delete require.cache[key];
    }
  }
}

export function model(patch = {}) {
  const events = [];
  const bytes = patch.bytes ?? fixture;
  const metadata = { ...state, size: bytes.length, ...patch.state };
  let calls = 0,
    cleanupCalls = 0;
  const status = { admission: 'closed', exit: 'confirmed', streams: 'confirmed' };
  const pipe = {
    request: vi.fn(async (body) => {
      events.push(body.op);
      const id = ++calls;
      if (patch.response) return patch.response(body, id);
      let value;
      if (['open', 'tail', 'stat'].includes(body.op)) value = { id, ok: true, ...metadata };
      else if (body.op === 'close') value = { id, ok: true, closed: true };
      else
        value = {
          id,
          ok: true,
          data: bytes.subarray(body.position, body.position + body.length).toString('base64'),
        };
      return patch.mapResponse ? patch.mapResponse(body, value) : value;
    }),
    close: vi.fn(async () => {
      events.push('cleanup');
      cleanupCalls++;
      if (patch.cleanup) await patch.cleanup(cleanupCalls);
      return { ...status };
    }),
  };
  const guard = vi.fn(() => {});
  const spawn = vi.fn(() => ({}));
  const assets = {
    failure: () => Error('session-windows-io-failed'),
    privateMode: guard,
    qualifyAssets: () => ({ executable: 'fixed.exe', cwd: 'fixed', env: {} }),
  };
  const wire = require('../../../src/main/claude-hook-windows-io-wire');
  const childProcess = require('node:child_process');
  const savedSpawn = childProcess.spawn;
  childProcess.spawn = spawn;
  let ioModule;
  try {
    ioModule = load('../../../src/main/session-context-windows-io', {
      '../../../src/main/session-context-windows-assets': assets,
      '../../../src/main/claude-hook-windows-io-wire': { ...wire, createPipe: () => pipe },
    });
  } finally {
    childProcess.spawn = savedSpawn;
  }
  const wrapper = load('../../../src/main/session-context-windows-reader', {
    '../../../src/main/session-context-windows-assets': assets,
    '../../../src/main/session-context-windows-io': ioModule,
  });
  const adapter = {
    parse: vi.fn((_source, raw) => {
      events.push('parse');
      return Object.freeze({ available: raw !== null });
    }),
  };
  return {
    events,
    pipe,
    guard,
    spawn,
    status,
    adapter,
    bytes,
    metadata,
    io: () => ioModule.createWindowsSessionContextIO(options),
    reader: (settings = { ...options, adapter }) =>
      wrapper.createWindowsSessionContextReader(settings),
  };
}
