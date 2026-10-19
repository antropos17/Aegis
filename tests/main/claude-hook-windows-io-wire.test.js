import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

const require = createRequire(import.meta.url);
const { createPipe, MAX_FRAME } = require('../../src/main/claude-hook-windows-io-wire');
const limits = { requestMs: 100, sessionMs: 1000, cleanupMs: 100 };
const fixed = { message: 'private-windows-io-failed' };
function frame(value) {
  const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
}
function fixture(reply, exitConfirmed = true) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCount = 0;
  child.stdin = new Writable({
    write(bytes, encoding, done) {
      const copy = Buffer.from(bytes);
      setImmediate(() => {
        reply?.(JSON.parse(copy.subarray(4).toString('utf8')), child);
        copy.fill(0);
      });
      done();
    },
  });
  child.kill = () => {
    child.killCount++;
    if (exitConfirmed)
      setImmediate(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.emit('exit', null, 'SIGKILL');
        child.emit('close', null, 'SIGKILL');
      });
    return exitConfirmed;
  };
  return { child, pipe: createPipe(child, limits) };
}

describe('private Windows hook IO framed child ownership', () => {
  it('accepts split length/payload frames and monotonically identifies separate requests', async () => {
    const seen = [];
    const f = fixture((request, child) => {
      seen.push(request.id);
      const bytes = frame({ id: request.id, ok: true, protocol: 1 });
      child.stdout.write(bytes.subarray(0, 2));
      child.stdout.write(bytes.subarray(2, 7));
      child.stdout.write(bytes.subarray(7));
    });
    expect((await f.pipe.request({ op: 'open' })).protocol).toBe(1);
    expect((await f.pipe.request({ op: 'read' })).id).toBe(2);
    expect(seen).toEqual([1, 2]);
    expect(await f.pipe.close()).toEqual({
      admission: 'closed',
      exit: 'confirmed',
      streams: 'confirmed',
    });
    expect(f.child.killCount).toBe(1);
  });

  it('admits only one outstanding request and never sends the refused second request', async () => {
    const f = fixture();
    const first = f.pipe.request({ op: 'read' });
    await expect(f.pipe.request({ op: 'commit' })).rejects.toEqual(expect.objectContaining(fixed));
    f.child.stdout.write(frame({ id: 1, ok: true }));
    await first;
    await f.pipe.close();
  });

  for (const [name, output] of [
    ['malformed JSON', frame('{broken')],
    ['wrong request ID', frame({ id: 2, ok: true })],
    ['duplicate response key', frame('{"id":1,"id":1,"ok":true}')],
    ['escaped response key', frame('{"\\u0069d":1,"ok":true}')],
    ['trailing JSON', frame('{"id":1,"ok":true}{}')],
    ['nested object', frame({ id: 1, ok: true, value: {} })],
    ['invalid UTF8', Buffer.from([1, 0, 0, 0, 255])],
    ['zero length', Buffer.alloc(4)],
    [
      'overflow frame',
      (() => {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(MAX_FRAME + 1);
        return b;
      })(),
    ],
    [
      'multiple response frames',
      Buffer.concat([frame({ id: 1, ok: true }), frame({ id: 1, ok: true })]),
    ],
    ['native fixed failure', frame({ id: 1, ok: false })],
  ])
    it(`permanently closes admission for ${name}`, async () => {
      const f = fixture((request, child) => child.stdout.write(output));
      await expect(f.pipe.request({ op: 'commit' })).rejects.toEqual(
        expect.objectContaining(fixed),
      );
      await expect(f.pipe.request({ op: 'read' })).rejects.toEqual(expect.objectContaining(fixed));
      expect(f.pipe.status()).toEqual({
        admission: 'closed',
        exit: 'confirmed',
        streams: 'confirmed',
      });
      expect(f.child.killCount).toBe(1);
    });

  it('rejects a truncated response at disconnect without retrying or restoring', async () => {
    const f = fixture((request, child) => {
      child.stdout.write(Buffer.from([20, 0, 0, 0, 123]));
      child.stdout.end();
    });
    await expect(f.pipe.request({ op: 'commit' })).rejects.toEqual(expect.objectContaining(fixed));
    expect(f.child.killCount).toBe(1);
  });

  it('treats diagnostics as a private terminal failure without projecting their content', async () => {
    const f = fixture((request, child) => child.stderr.write('private-path-and-config'));
    await expect(f.pipe.request({ op: 'read' })).rejects.toEqual(expect.objectContaining(fixed));
    expect(f.pipe.status().admission).toBe('closed');
  });

  it('bounds stalled native work by the parent monotonic request deadline', async () => {
    const f = fixture();
    await expect(f.pipe.request({ op: 'commit' })).rejects.toEqual(expect.objectContaining(fixed));
    expect(f.pipe.status().exit).toBe('confirmed');
    expect(f.child.killCount).toBe(1);
  });

  it('refuses a late response even when blocked JS delays its timeout callback', async () => {
    const f = fixture((request, child) => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 130);
      child.stdout.write(frame({ id: request.id, ok: true }));
    });
    await expect(f.pipe.request({ op: 'commit' })).rejects.toEqual(expect.objectContaining(fixed));
    expect(f.pipe.status().admission).toBe('closed');
  });

  it('retains unknown exit/streams when owned-handle termination is unconfirmed', async () => {
    const f = fixture(undefined, false);
    await expect(f.pipe.request({ op: 'commit' })).rejects.toEqual(expect.objectContaining(fixed));
    expect(await f.pipe.close()).toEqual({
      admission: 'closed',
      exit: 'unknown',
      streams: 'unknown',
    });
    expect(f.child.killCount).toBe(1);
    f.child.stdout.destroy();
    f.child.stderr.destroy();
    f.child.emit('exit', 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.pipe.status()).toEqual({ admission: 'closed', exit: 'unknown', streams: 'unknown' });
  });

  it('bounds overflow drain and keeps its stream outcome unknown', async () => {
    const f = fixture((request, child) => {
      child.stdout.write(Buffer.alloc(MAX_FRAME + 5));
      child.stdout.write(Buffer.alloc(MAX_FRAME * 2 + 1));
    });
    await expect(f.pipe.request({ op: 'commit' })).rejects.toEqual(expect.objectContaining(fixed));
    expect(f.pipe.status().streams).toBe('unknown');
  });

  it('rejects oversized requests before writing a frame', async () => {
    let writes = 0;
    const f = fixture(() => {
      writes++;
    });
    await expect(f.pipe.request({ op: 'commit', value: 'a'.repeat(MAX_FRAME) })).rejects.toEqual(
      expect.objectContaining(fixed),
    );
    expect(writes).toBe(0);
    await f.pipe.close();
  });
});
