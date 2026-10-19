/** @file Bounded sensor/1 request transport for one owned child. @since 0.19.2-beta */
'use strict';
const wire = require('./sensor-protocol');

/** Bind a child without retaining diagnostics or an unbounded request queue.
 * @param {object} options Child, current-generation gate and synchronous callbacks.
 * @returns {object} Request, deadline and cancellation operations.
 * @since 0.19.2-beta
 */
function createTransport({ child, current, accept, fault, progress, mono, timeoutMs }) {
  let pending = null;
  let writing = false;
  let drained = true;
  let writeAt = 0;
  let cancelled = false;
  let ending = false;
  let stderrBytes = 0;
  const active = () => !cancelled && current();
  const decoder = wire.createFrameDecoder({
    direction: 'sensor-to-host',
    onMessage(message) {
      if (active()) accept(message);
    },
  });
  const fail = (code) => {
    if (active()) fault(code);
  };
  child.on('error', () => fail('launch-failed'));
  for (const stream of [child.stdin, child.stdout, child.stderr])
    stream?.on('error', () => fail('stream-failed'));
  child.stdout?.on('data', (bytes) => {
    if (!active()) return;
    const result = decoder.push(bytes);
    if (result.fatal) fail('protocol-failed');
  });
  child.stdout?.on('end', () => {
    if (!active()) return;
    if (decoder.finish().fatal) fail('protocol-failed');
    else if (!ending) fail('stream-ended');
  });
  child.stderr?.on('data', (bytes) => {
    if (active()) stderrBytes = Math.min(1048576, stderrBytes + bytes.length);
  });
  child.stdin?.on('drain', () => {
    if (!active()) return;
    drained = true;
    progress();
  });
  return {
    ready: () => active() && !pending && !writing && drained,
    send(message, reply) {
      if (!active() || pending || writing || !drained) return false;
      let bytes;
      try {
        bytes = wire.encodeFrame(message, { direction: 'host-to-sensor' });
      } catch {
        fail('request-encoding-failed');
        return false;
      }
      pending = { id: message.id, type: message.t, at: mono(), reply };
      writing = true;
      writeAt = mono();
      try {
        // Callback and drain are independent gates. A synchronous test callback
        // cannot flush another write until write() has returned its pressure bit.
        drained = false;
        const accepted = child.stdin.write(bytes, (error) => {
          if (!active()) return;
          writing = false;
          if (error) fail('write-failed');
          else
            queueMicrotask(() => {
              if (active()) progress();
            });
        });
        if (accepted) drained = true;
      } catch {
        fail('write-failed');
        return false;
      }
      return true;
    },
    reply(message) {
      if (!pending || message.id !== pending.id) return false;
      if (message.t !== 'err' && message.t !== (pending.type === 'snap' ? 'snap' : 'ack'))
        return false;
      const item = pending;
      pending = null;
      item.reply(message);
      if (active()) progress();
      return true;
    },
    tick() {
      if (!active()) return;
      if (
        (pending && mono() - pending.at >= timeoutMs) ||
        ((writing || !drained) && mono() - writeAt >= timeoutMs)
      )
        fail('request-timeout');
    },
    end() {
      ending = true;
      child.stdin?.end();
    },
    cancel() {
      cancelled = true;
      pending = null;
    },
    hasStreams: () => Boolean(child.stdin && child.stdout && child.stderr),
    getCounts: () => ({ stderrBytes }),
  };
}
module.exports = { createTransport };
