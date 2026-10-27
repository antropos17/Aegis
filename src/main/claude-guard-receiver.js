'use strict';

const http = require('node:http');
const path = require('node:path');
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const LIMITS = Object.freeze({
  requestBytes: 1024,
  totalBytes: 262144,
  requests: 256,
  connections: 256,
  concurrent: 8,
  records: 32,
  requestMs: 2000,
  approvalMs: 60000,
  verifyMs: 3500,
  durationMs: 150000,
});
const REASONS = Object.freeze({
  generic: ['allow', 'ask', 'deny'],
  'project-review-ordinary': ['ask'],
  'project-review-script': ['ask'],
  'project-review-edit': ['ask'],
  'project-deny-sensitive': ['deny'],
  'project-deny-destructive': ['deny'],
  'project-deny-unsupported': ['deny'],
  'adapter-failure': ['deny'],
});
const CLAIM = /^\{"code":"([0-9]{6})","nonce":"([a-f0-9]{32})"\}$/;
const DECISION =
  /^\{"decision":"(allow|ask|deny)","reason":"(generic|project-review-ordinary|project-review-script|project-review-edit|project-deny-sensitive|project-deny-destructive|project-deny-unsupported|adapter-failure)"\}$/;

function validSelection(value) {
  if (!value || typeof value !== 'object') return false;
  const names = ['executable', 'settings', 'cwd'];
  return (
    Object.keys(value).length === names.length &&
    names.every((name) => {
      const item = value[name];
      return (
        typeof item === 'string' &&
        item.length > 0 &&
        item.length <= 4096 &&
        (path.isAbsolute(item) || path.win32.isAbsolute(item)) &&
        // eslint-disable-next-line no-control-regex -- Private selected paths cannot contain terminal controls.
        !/[\u0000-\u001f\u007f]/u.test(item)
      );
    })
  );
}

/** Start a finite capability-gated observer for a user-selected launch.
 * Capability possession does not establish sender identity, delivery completeness,
 * provider approval or an action effect. No request input is persisted.
 * @param {object} options Trusted launch selection, confirmation and optional clock.
 * @returns {Promise<object>} Bounded local endpoint, detached snapshot and close.
 * @since v0.21.0 */
async function startClaudeGuardReceiver({
  selection,
  approve,
  verify,
  now = () => performance.now(),
}) {
  if (
    !validSelection(selection) ||
    typeof approve !== 'function' ||
    typeof verify !== 'function' ||
    typeof now !== 'function'
  )
    throw Error('observer-configuration-invalid');
  const started = now();
  if (!Number.isFinite(started) || started < 0) throw Error('observer-clock-invalid');
  const selected = Object.freeze({
    executable: selection.executable,
    settings: selection.settings,
    cwd: selection.cwd,
  });
  const sessionId = randomBytes(16).toString('hex');
  const token = randomBytes(32);
  const publicLaunchKey = randomBytes(12).toString('hex');
  const launchKey = Buffer.from(publicLaunchKey, 'ascii');
  const expected = Buffer.from(`Bearer ${token.toString('hex')}`);
  const sockets = new Set();
  const records = [];
  let status = 'waiting',
    loss = false,
    closed = false,
    closing,
    timer;
  let requests = 0,
    connections = 0,
    totalBytes = 0;
  let port = 0;
  let startReserved = false,
    launchStarted = false;

  function expired() {
    try {
      const current = now();
      return (
        !Number.isFinite(current) || current < started || current - started >= LIMITS.durationMs
      );
    } catch {
      return true;
    }
  }
  function snapshot() {
    if (!closed && expired()) {
      loss = true;
      void finish('expired');
    }
    return {
      status,
      available: !closed && status === 'active',
      lossDetected: loss,
      delivery: 'unknown',
      sender: 'unverified',
      effect: 'unknown',
      entries: records.map((record) => ({ ...record })),
    };
  }
  function close() {
    return finish('ended');
  }
  function finish(finalStatus) {
    if (closing) return closing;
    closed = true;
    if (status === 'awaiting-confirmation' || status === 'active') loss = true;
    if (sockets.size > 1) loss = true;
    status = finalStatus;
    clearTimeout(timer);
    token.fill(0);
    launchKey.fill(0);
    expected.fill(0);
    for (const socket of sockets) socket.destroy();
    closing = new Promise((resolve) => server.close(() => resolve(snapshot())));
    return closing;
  }
  function fail(res, code = 400) {
    loss = true;
    if (!res.destroyed && !res.headersSent) {
      res.writeHead(code, { Connection: 'close' });
      res.end();
    }
  }
  function headersOnce(req) {
    if (req.rawHeaders.length > 32) return false;
    const counts = new Map();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i].toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return ['host', 'authorization', 'content-type', 'content-length'].every(
      (key) => (counts.get(key) || 0) <= 1,
    );
  }
  function authorized(req) {
    const supplied = Buffer.from(
      typeof req.headers.authorization === 'string' ? req.headers.authorization : '',
    );
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  function handle(req, res) {
    res.setHeader('Connection', 'close');
    if (closed || expired()) {
      fail(res, 503);
      void finish('expired');
      return;
    }
    if (++requests > LIMITS.requests) {
      loss = true;
      void close();
      return;
    }
    const claim = req.url === `/claim/${sessionId}`;
    const decision = req.url === `/decision/${sessionId}`;
    const start = req.url === `/start/${sessionId}`;
    const ending = req.url === `/finish/${sessionId}`;
    if (
      req.method !== 'POST' ||
      (!claim && !decision && !start && !ending) ||
      req.headers.host !== `127.0.0.1:${port}` ||
      req.headers['content-type'] !== 'application/json' ||
      Object.hasOwn(req.headers, 'origin') ||
      Object.hasOwn(req.headers, 'content-encoding') ||
      !headersOnce(req)
    )
      return fail(res);
    if (claim) {
      // Reserve before reading input or awaiting confirmation. Retries never receive a capability.
      if (status !== 'waiting') return fail(res, 409);
      status = 'awaiting-confirmation';
    } else if (status !== 'active' || !authorized(req)) return fail(res, 403);
    if (start) {
      if (startReserved) return fail(res, 409);
      startReserved = true;
    }
    if (decision && !launchStarted) return fail(res, 409);

    let ended = false,
      responseClosed = false,
      bytes = 0;
    const chunks = [];
    const requestTimer = setTimeout(() => {
      loss = true;
      req.destroy();
    }, LIMITS.requestMs);
    res.on('close', () => {
      responseClosed = !res.writableFinished;
      if (responseClosed && !closed) {
        loss = true;
        if (claim && status === 'awaiting-confirmation') void finish('refused');
        if (ending && status === 'ended') void finish('ended');
      }
    });
    req.on('error', () => {
      loss = true;
    });
    req.on('close', () => {
      clearTimeout(requestTimer);
      chunks.length = 0;
      if (!ended && !closed) {
        loss = true;
        if (claim && status === 'awaiting-confirmation') void finish('refused');
      }
    });
    req.on('data', (chunk) => {
      bytes += chunk.length;
      totalBytes += chunk.length;
      if (bytes > LIMITS.requestBytes || totalBytes > LIMITS.totalBytes) {
        loss = true;
        if (claim) void finish('refused');
        req.destroy();
        if (totalBytes > LIMITS.totalBytes) void close();
      } else chunks.push(chunk);
    });
    req.on('end', async () => {
      ended = true;
      clearTimeout(requestTimer);
      req.socket.setTimeout(0);
      if (closed || req.destroyed || responseClosed) return;
      if (expired()) {
        loss = true;
        void finish('expired');
        return;
      }
      const body = Buffer.concat(chunks, bytes);
      chunks.length = 0;
      const text = body.toString('utf8');
      body.fill(0);
      if (claim) {
        const match = CLAIM.exec(text);
        if (!match) {
          res.once('finish', () => void finish('refused'));
          fail(res);
          return;
        }
        let approved, approvalTimer;
        try {
          approved = await Promise.race([
            Promise.resolve().then(() => approve(match[1])),
            new Promise((resolve) => {
              approvalTimer = setTimeout(() => resolve(false), LIMITS.approvalMs);
              approvalTimer.unref?.();
            }),
          ]);
        } catch {
          approved = false;
        }
        clearTimeout(approvalTimer);
        if (closed || responseClosed || res.destroyed || status !== 'awaiting-confirmation') return;
        if (expired()) {
          loss = true;
          void finish('expired');
          return;
        }
        if (approved !== true) {
          res.once('finish', () => void finish('refused'));
          fail(res, 403);
          return;
        }
        status = 'active';
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        const releasedToken = token.toString('hex');
        const proof = createHmac('sha256', launchKey)
          .update(
            JSON.stringify([
              sessionId,
              match[1],
              match[2],
              releasedToken,
              selected.executable,
              selected.settings,
              selected.cwd,
            ]),
          )
          .digest('hex');
        res.end(JSON.stringify({ token: releasedToken, ...selected, proof }));
      } else {
        // A finish request can revoke admission while a decision body is still arriving.
        if (status !== 'active') return fail(res, 403);
        if (start) {
          if (text !== '{}') {
            res.once('finish', () => void finish('refused'));
            return fail(res, 422);
          }
          let valid, verifyTimer;
          try {
            valid = await Promise.race([
              Promise.resolve().then(() => verify()),
              new Promise((resolve) => {
                verifyTimer = setTimeout(() => resolve(false), LIMITS.verifyMs);
                verifyTimer.unref?.();
              }),
            ]);
          } catch {
            valid = false;
          }
          clearTimeout(verifyTimer);
          if (closed || responseClosed || res.destroyed || status !== 'active') return;
          if (valid !== true || expired()) {
            res.once('finish', () => void finish('refused'));
            return fail(res, 403);
          }
          launchStarted = true;
          res.writeHead(204, { Connection: 'close' });
          res.end();
          return;
        }
        if (ending) {
          if (text !== '{}') return fail(res, 422);
          status = 'ended';
          token.fill(0);
          launchKey.fill(0);
          expected.fill(0);
          res.once('finish', () => void finish('ended'));
          res.writeHead(204, { Connection: 'close' });
          res.end();
          return;
        }
        const match = DECISION.exec(text);
        if (!match || !REASONS[match[2]].includes(match[1])) return fail(res, 422);
        records.push({ decision: match[1], reason: match[2] });
        if (records.length > LIMITS.records) {
          records.shift();
          loss = true;
        }
        res.writeHead(204, { Connection: 'close' });
        res.end();
      }
    });
  }

  const server = http.createServer({ maxHeaderSize: 4096, headersTimeout: 2000 }, handle);
  server.maxHeadersCount = 16;
  server.maxRequestsPerSocket = 1;
  server.keepAliveTimeout = 1;
  server.on('connection', (socket) => {
    if (closed || ++connections > LIMITS.connections || sockets.size >= LIMITS.concurrent) {
      loss = true;
      socket.destroy();
      if (connections > LIMITS.connections) void close();
      return;
    }
    sockets.add(socket);
    socket.setTimeout(LIMITS.requestMs, () => {
      loss = true;
      socket.destroy();
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });
  server.on('clientError', (_error, socket) => {
    loss = true;
    socket.destroy();
  });
  server.on('upgrade', (_req, socket) => {
    loss = true;
    socket.destroy();
  });
  server.on('checkContinue', (_req, res) => fail(res, 417));
  server.on('checkExpectation', (_req, res) => fail(res, 417));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  }).catch(() => {
    token.fill(0);
    launchKey.fill(0);
    expected.fill(0);
    throw Error('observer-listen-unavailable');
  });
  port = server.address().port;
  server.removeAllListeners('error');
  server.on('error', () => {
    loss = true;
    void close();
  });
  timer = setTimeout(() => {
    loss = true;
    void finish('expired');
  }, LIMITS.durationMs);
  timer.unref?.();
  return Object.freeze({ port, sessionId, launchKey: publicLaunchKey, snapshot, close });
}

module.exports = { startClaudeGuardReceiver, LIMITS };
