'use strict';
const net = require('node:net');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { CASES, LIMIT, endpoints, validToken, dnsAnswer, json, digest } = require('./protocol.cjs');

/** Create owned loopback receivers with independent receive/EOF observations. @since draft1 */
async function createReceiver() {
  const nonce = crypto.randomBytes(16).toString('hex');
  const ports = {};
  const counts = CASES.map(() => 0);
  const eof = CASES.map(() => 0);
  const sockets = new Set();
  const handles = [];
  let bytes = 0, packets = 0, rejected = 0, accepted = 0, receiverError = false;
  let closing = false, closed = false, ready = false, closeRefusal = false, closePromise, notifyClosed;
  const whenClosed = new Promise((resolve) => { notifyClosed = resolve; });
  const deadline = setTimeout(() => void close(), 18000);
  function account(size) {
    bytes += size;
    packets++;
    if (size > LIMIT.message || bytes > LIMIT.total || packets > LIMIT.packets) {
      receiverError = true;
      void close();
      return false;
    }
    return !closing;
  }
  function reject() { rejected++; }
  try {
    for (const family of [4, 6]) {
      const address = family === 4 ? '127.0.0.1' : '::1';
      const index = family === 4 ? 0 : 1;
      const server = net.createServer({ allowHalfOpen: false }, (socket) => {
        if (!ready || closing) { reject(); socket.destroy(); return; }
        accepted++;
        if (accepted > 8 || sockets.size >= 4) {
          receiverError = true; reject(); socket.destroy(); void close(); return;
        }
        sockets.add(socket);
        let pending = Buffer.alloc(0), connectionBytes = 0, caseIndex = null, phase = 0;
        socket.on('data', (data) => {
          connectionBytes += data.length;
          if (connectionBytes > LIMIT.message) {
            receiverError = true; reject(); socket.destroy(); void close(); return;
          }
          if (!account(data.length)) { socket.destroy(); return; }
          pending = Buffer.concat([pending, data]);
          while (pending.length >= 32) {
            const value = pending.subarray(0, 32);
            pending = pending.subarray(32);
            const selected = value[20];
            if (!validToken(value, nonce, [index, index + 8]) || value[21] !== phase
              || (caseIndex !== null && caseIndex !== selected) || (selected === index && phase !== 0)) {
              reject(); socket.destroy(); return;
            }
            caseIndex = selected;
            phase++;
            counts[selected]++;
            socket.write(value);
          }
        });
        socket.on('end', () => {
          if (pending.length) reject();
          if (caseIndex !== null) eof[caseIndex]++;
        });
        socket.on('error', () => { receiverError = true; });
        socket.on('close', () => sockets.delete(socket));
      });
      handles.push(server);
      server.on('error', () => { receiverError = true; });
      await new Promise((resolve, rejectReady) => {
        server.once('error', rejectReady);
        server.listen({ host: address, port: 0, ipv6Only: family === 6 }, () => {
          server.removeListener('error', rejectReady);
          ports[`tcp${family}`] = server.address().port;
          resolve();
        });
      });
      const udp = dgram.createSocket(family === 4 ? 'udp4' : 'udp6');
      handles.push(udp);
      udp.on('error', () => { receiverError = true; });
      udp.on('message', (value, remote) => {
        if (!ready || closing) { reject(); return; }
        if (!account(value.length) || remote.address !== address) { reject(); return; }
        let answer;
        if (validToken(value, nonce, [index + 2]) && value[21] === 0) {
          counts[index + 2]++;
          answer = value;
        } else {
          answer = dnsAnswer(value, nonce, family);
          if (answer) counts[index + 4]++;
          else { reject(); return; }
        }
        udp.send(answer, remote.port, address, (error) => { if (error) receiverError = true; });
      });
      await new Promise((resolve, rejectReady) => {
        udp.once('error', rejectReady);
        udp.bind(0, address, () => {
          udp.removeListener('error', rejectReady);
          ports[`udp${family}`] = udp.address().port;
          resolve();
        });
      });
    }
  } catch {
    receiverError = true;
    await close();
    throw new Error('receiver-unavailable');
  }
  ready = true;
  const endpoint = endpoints({ schemaVersion: 1, nonce, ports });
  function receipt() {
    return { schemaVersion: 1, scope: 'loopback-calibration', nonceDigest: digest(nonce),
      cases: CASES.map((id, i) => ({ id, received: counts[i], eof: eof[i] })),
      bytes, packets, accepted, rejected, receiverError, closed, openConnections: sockets.size };
  }
  function close() {
    if (closePromise) return closePromise;
    closing = true;
    clearTimeout(deadline);
    for (const socket of sockets) socket.destroy();
    closePromise = new Promise((resolve) => {
      let completed = false;
      const finish = (allCallbacks) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        closed = allCallbacks && !closeRefusal && sockets.size === 0;
        if (!closed) receiverError = true;
        const value = receipt();
        notifyClosed(value);
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), 2000);
      Promise.all(handles.map((handle) => new Promise((resolveHandle) => {
        try { handle.close(resolveHandle); } catch { closeRefusal = true; receiverError = true; resolveHandle(); }
      }))).then(() => finish(true));
    });
    return closePromise;
  }
  return { endpoint, receipt, close, whenClosed };
}

async function main() {
  let receiver;
  const watchdog = setTimeout(() => {
    process.stdout.write(json({ type: 'failed', reason: 'receiver-deadline', closed: false }) + '\n');
    process.exit(2);
  }, 20000);
  try {
    if (process.argv.length !== 2) throw new Error('invalid-invocation');
    receiver = await createReceiver();
    process.stdout.write(json({ type: 'ready', endpoint: receiver.endpoint }) + '\n');
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (value) => {
      input += value;
      if (Buffer.byteLength(input) > 16 || input === 'stop\n') process.stdin.destroy();
    });
    await Promise.race([receiver.whenClosed, new Promise((resolve) => {
      process.stdin.once('close', resolve);
      process.stdin.once('end', resolve);
    })]);
    process.stdin.destroy();
    const receipt = await receiver.close();
    process.stdout.write(json({ type: 'closed', receipt }) + '\n');
    clearTimeout(watchdog);
    if (!receipt.closed || receipt.receiverError) process.exit(2);
  } catch {
    if (receiver) await receiver.close();
    process.stdout.write(json({ type: 'failed', reason: 'receiver-unavailable' }) + '\n');
    clearTimeout(watchdog);
    process.exit(2);
  }
}
if (require.main === module) void main();
module.exports = { createReceiver };
