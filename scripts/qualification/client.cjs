'use strict';
const net = require('node:net');
const dgram = require('node:dgram');
const dns = require('node:dns');
const { CASES, LIMIT, endpoints, token, json, digest } = require('./protocol.cjs');

function code(error) {
  return typeof error?.code === 'string' && /^[A-Z_]{1,40}$/.test(error.code) ? error.code : 'API_ERROR';
}
function tcp(endpoint, family, held) {
  endpoint = endpoints(endpoint);
  if (![4, 6].includes(family) || typeof held !== 'boolean') throw new Error('invalid-tcp-control');
  return new Promise((resolve) => {
    const index = (family === 4 ? 0 : 1) + (held ? 8 : 0);
    const address = family === 4 ? '127.0.0.1' : '::1';
    const socket = new net.Socket();
    const expected = held ? 2 : 1;
    let phase = 0, pending = Buffer.alloc(0), failed = false, remoteEnded = false, observed = 'unknown';
    let secondTimer;
    function reject(reason) {
      if (!failed) observed = reason;
      failed = true;
      clearTimeout(secondTimer);
      socket.destroy();
    }
    const timer = setTimeout(() => reject('deadline'), 750);
    socket.on('error', (error) => reject(code(error)));
    socket.on('end', () => {
      remoteEnded = true;
      if (pending.length !== 0) reject('trailing-frame');
      else if (phase !== expected) reject('incomplete-exchanges');
    });
    socket.on('close', () => {
      clearTimeout(timer); clearTimeout(secondTimer);
      const passed = !failed && remoteEnded && phase === expected && pending.length === 0;
      if (passed) observed = 'exact-echo';
      else if (!failed) observed = 'incomplete-close';
      resolve({ passed, observed, closed: true, exchanges: phase });
    });
    socket.on('data', (value) => {
      if (failed) return;
      pending = Buffer.concat([pending, value]);
      if (pending.length > 32) { reject('unexpected-echo'); return; }
      if (pending.length !== 32) return;
      if (phase >= expected || !pending.equals(token(endpoint.nonce, index, phase))) {
        reject('unexpected-echo'); return;
      }
      pending = Buffer.alloc(0);
      phase++;
      if (held && phase === 1) {
        secondTimer = setTimeout(() => {
          if (!failed) socket.write(token(endpoint.nonce, index, 1));
        }, 20);
      } else {
        observed = 'echo-observed-awaiting-eof'; socket.end();
      }
    });
    socket.connect({ host: address, port: endpoint.ports[`tcp${family}`], family }, () => {
      if (socket.remoteAddress !== address) { reject('unexpected-peer'); return; }
      socket.write(token(endpoint.nonce, index));
    });
  });
}
function udp(endpoint, family) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket(family === 4 ? 'udp4' : 'udp6');
    const address = family === 4 ? '127.0.0.1' : '::1';
    const value = token(endpoint.nonce, family === 4 ? 2 : 3);
    let finished = false, submitted = false;
    const timer = setTimeout(() => finish(false, submitted ? 'submitted-delivery-unobserved' : 'deadline'), 750);
    function finish(passed, observed) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(() => resolve({ passed, observed, closed: true, submitted })); }
      catch { resolve({ passed: false, observed: 'close-unavailable', closed: false, submitted }); }
    }
    socket.on('error', (error) => finish(false, code(error)));
    socket.on('message', (answer, remote) => {
      const matched = answer.equals(value) && remote.address === address && remote.port === endpoint.ports[`udp${family}`];
      finish(matched, matched ? 'exact-echo' : 'unexpected-echo');
    });
    socket.bind(0, address, () => {
      socket.send(value, endpoint.ports[`udp${family}`], address, (error) => {
        if (error) finish(false, code(error));
        else submitted = true;
      });
    });
  });
}
function resolveDns(endpoint, family) {
  return new Promise((resolve) => {
    const resolver = new dns.Resolver({ timeout: 500, tries: 1 });
    resolver.setServers([family === 4 ? `127.0.0.1:${endpoint.ports.udp4}` : `[::1]:${endpoint.ports.udp6}`]);
    let expired = false;
    const timer = setTimeout(() => { expired = true; resolver.cancel(); }, 750);
    const callback = (error, addresses) => {
      clearTimeout(timer);
      resolver.cancel();
      const expected = family === 4 ? '127.0.0.1' : '::1';
      const passed = !expired && !error && addresses.length === 1 && addresses[0] === expected;
      resolve({ passed, observed: expired ? 'deadline' : error ? code(error) : passed ? 'owned-answer' : 'unexpected-answer',
        closed: true });
    };
    resolver[family === 4 ? 'resolve4' : 'resolve6'](`n${endpoint.nonce}.aegis-control.invalid`, callback);
  });
}
function lookup(family) {
  return new Promise((resolve) => {
    let expired = false;
    // OS lookup has no cancellation API. Keep its completion distinct from the observed deadline.
    const timer = setTimeout(() => { expired = true; }, 750);
    dns.lookup('localhost', { family }, (error, address, actualFamily) => {
      clearTimeout(timer);
      const passed = !expired && !error && actualFamily === family && address === (family === 4 ? '127.0.0.1' : '::1');
      resolve({ passed, observed: expired ? 'deadline-completion' : error ? code(error) : passed ? 'os-loopback-answer' : 'unexpected-answer',
        closed: true });
    });
  });
}

/** Run ten fixed loopback controls only; this draft implements no route-negative probes. @since draft1 */
async function runClient(input) {
  const endpoint = endpoints(input);
  const start = Date.now();
  const operations = [
    () => tcp(endpoint, 4, false), () => tcp(endpoint, 6, false),
    () => udp(endpoint, 4), () => udp(endpoint, 6),
    () => resolveDns(endpoint, 4), () => resolveDns(endpoint, 6),
    () => lookup(4), () => lookup(6),
    () => tcp(endpoint, 4, true), () => tcp(endpoint, 6, true),
  ];
  const cases = [];
  for (let i = 0; i < operations.length; i++) {
    const before = Date.now();
    // The parent must terminate the actual owned process at 20s; uncancellable OS lookup is explicit.
    if (before - start > 15000) {
      cases.push({ id: CASES[i], passed: false, observed: 'corpus-deadline', closed: true, elapsedMs: 0 });
      continue;
    }
    const result = await operations[i]();
    cases.push({ id: CASES[i], ...result, elapsedMs: Date.now() - before });
  }
  const result = { schemaVersion: 1, scope: 'loopback-calibration', nonceDigest: digest(endpoint.nonce),
    loopbackControlsComplete: cases.every((value) => value.passed && value.closed),
    labCorpusComplete: false, e3Qualified: false, launchAllowed: false,
    omitted: ['direct-tcp4', 'direct-tcp6', 'direct-udp4', 'direct-udp6', 'no-route-dns4', 'no-route-dns6'],
    elapsedMs: Date.now() - start, cases };
  json(result);
  return result;
}

async function main() {
  const watchdog = setTimeout(() => {
    process.stdout.write(json({ schemaVersion: 1, passed: false, reason: 'client-deadline',
      e3Qualified: false, launchAllowed: false }) + '\n');
    process.exit(2);
  }, 20000);
  try {
    if (process.argv.length !== 2) throw new Error('invalid-invocation');
    let input = Buffer.alloc(0);
    for await (const chunk of process.stdin) {
      if (input.length + chunk.length > LIMIT.input) throw new Error('input-limit');
      input = Buffer.concat([input, chunk]);
    }
    const result = await runClient(JSON.parse(input.toString('utf8')));
    process.stdout.write(json(result) + '\n');
    clearTimeout(watchdog);
    if (!result.loopbackControlsComplete) process.exitCode = 2;
  } catch {
    process.stdout.write(json({ schemaVersion: 1, passed: false, reason: 'client-control-unavailable',
      e3Qualified: false, launchAllowed: false }) + '\n');
    process.exitCode = 2;
    clearTimeout(watchdog);
  }
}
if (require.main === module) void main();
module.exports = { runClient, runTcpControl: tcp };
