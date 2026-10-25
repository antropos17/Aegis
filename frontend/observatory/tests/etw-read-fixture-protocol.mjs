const OUTPUT_LIMIT = 16384;
const QUEUE_LIMIT = 8;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CODES = [
  'output-budget',
  'queue-overflow',
  'invalid-response',
  'unexpected-response',
  'protocol-state',
  'spawn-error',
  'stdin-error',
  'stdout-error',
  'stderr-error',
  'stdout-ended',
  'timeout',
  'exit-failed',
  'close-unconfirmed',
];
const SIGNALS = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGBREAK', 'SIGHUP', 'other'];
const errorCode = (code) => `AEGIS_READ_FIXTURE_${code.replaceAll('-', '_').toUpperCase()}`;

/** Copy only a recognized reader refusal's closed immutable metadata snapshot.
 * @param {object} error Unknown caught failure.
 * @returns {object|null} Safe failure receipt, or null when the shape is unrecognized.
 * @since v0.20.1
 */
export function projectReadFixtureFailure(error) {
  const failureCode = CODES.find((code) => error?.code === errorCode(code));
  const value = error?.fixtureDiagnostic;
  const integer = (v, maximum) => Number.isInteger(v) && v >= 0 && v <= maximum;
  if (
    !failureCode ||
    !value ||
    !['ready', 'short', 'command', 'close'].includes(value.phase) ||
    ![null, 'ready', 'short', 'sync', 'async'].includes(value.expectedCommand) ||
    !integer(value.stdoutBytes, OUTPUT_LIMIT + 1) ||
    !integer(value.stderrBytes, OUTPUT_LIMIT + 1) ||
    !integer(value.queuedLines, QUEUE_LIMIT) ||
    !(
      value.exitCode === null ||
      (Number.isInteger(value.exitCode) &&
        value.exitCode >= -2147483648 &&
        value.exitCode <= 4294967295)
    ) ||
    !(value.signalCode === null || SIGNALS.includes(value.signalCode)) ||
    typeof value.stdoutEnded !== 'boolean' ||
    typeof value.stdinFailed !== 'boolean'
  )
    return null;
  return Object.freeze({
    schema: 'aegis-read-fixture-failure/1',
    failureCode,
    phase: value.phase,
    expectedCommand: value.expectedCommand,
    stdoutBytes: value.stdoutBytes,
    stderrBytes: value.stderrBytes,
    queuedLines: value.queuedLines,
    exitCode: value.exitCode,
    signalCode: value.signalCode,
    stdoutEnded: value.stdoutEnded,
    stdinFailed: value.stdinFailed,
  });
}

/** Bound the owned native reader's ready/command transport without retaining private output.
 * @param {object} child Owned child and its piped streams.
 * @param {boolean} short Whether the child emits ready/short and exits without commands.
 * @returns {object} Finite serial response and acknowledged-close interface.
 * @since v0.20.1
 */
export function readFixtureProtocol(child, short) {
  const lines = [];
  let partial = '';
  const decoder = new StringDecoder('utf8');
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutEnded = false;
  let stdinFailed = false;
  let receivedReady = false;
  let receivedShort = false;
  let responseReceived = false;
  let expectedCommand = 'ready';
  let nextCommand = 'ready';
  let phase = 'ready';
  let active = false;
  let closed = false;
  let processClosed = false;
  let processClosedAt = null;
  let failureReported = false;
  let failure;

  const diagnostic = () => ({
    phase,
    expectedCommand,
    stdoutBytes,
    stderrBytes,
    queuedLines: lines.length,
    exitCode: Number.isInteger(child.exitCode) ? child.exitCode : null,
    signalCode:
      child.signalCode === null || child.signalCode === undefined
        ? null
        : SIGNALS.includes(child.signalCode)
          ? child.signalCode
          : 'other',
    stdoutEnded,
    stdinFailed,
  });
  const refuse = (code) => {
    if (!failure) {
      const fixtureDiagnostic = Object.freeze(diagnostic());
      failure = Object.assign(new Error(`Read fixture refused: ${code}`), {
        code: errorCode(code),
        fixtureDiagnostic,
      });
      partial = '';
      lines.length = 0;
    }
    return failure;
  };
  const count = (stream, data) => {
    const length = Buffer.byteLength(data);
    if (stream === 'stdout') stdoutBytes = Math.min(OUTPUT_LIMIT + 1, stdoutBytes + length);
    else stderrBytes = Math.min(OUTPUT_LIMIT + 1, stderrBytes + length);
    if (stdoutBytes + stderrBytes > OUTPUT_LIMIT) refuse('output-budget');
    return !failure;
  };
  const report = (code) => {
    const error = code ? refuse(code) : failure;
    failureReported = true;
    return error;
  };
  child.on('error', () => refuse('spawn-error'));
  child.on('close', () => {
    processClosed = true;
    processClosedAt = Date.now();
  });
  child.stdin.on('error', () => {
    stdinFailed = true;
    refuse('stdin-error');
  });
  child.stdout.on('error', () => refuse('stdout-error'));
  child.stdout.on('data', (data) => {
    if (!count('stdout', data)) return;
    partial += decoder.write(data);
    let newline;
    while ((newline = partial.indexOf('\n')) !== -1 && !failure) {
      const line = partial.slice(0, newline).replace(/\r$/, '');
      partial = partial.slice(newline + 1);
      if (lines.length === QUEUE_LIMIT) {
        refuse('queue-overflow');
        break;
      }
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        refuse('invalid-response');
        break;
      }
      const incoming = !receivedReady
        ? 'ready'
        : short && !receivedShort
          ? 'short'
          : active && phase === 'command' && !responseReceived
            ? expectedCommand
            : null;
      if (
        incoming === null ||
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        value.command !== incoming
      ) {
        refuse('unexpected-response');
        break;
      }
      if (!receivedReady) receivedReady = true;
      else if (short) receivedShort = true;
      else responseReceived = true;
      lines.push({ value, at: Date.now() });
    }
  });
  child.stderr.on('data', (data) => count('stderr', data));
  child.stderr.on('error', () => refuse('stderr-error'));
  child.stdout.on('end', () => {
    stdoutEnded = true;
    if (!failure) partial += decoder.end();
    if (partial) refuse('invalid-response');
  });

  const take = async (command, write) => {
    if (failure) throw report();
    if (active || closed) throw report('protocol-state');
    active = true;
    expectedCommand = command;
    phase = command === 'ready' || command === 'short' ? command : 'command';
    responseReceived = false;
    let written = !write;
    let writtenAt = write ? null : Date.now();
    const until = Date.now() + 12000;
    try {
      if (write) {
        if (stdoutEnded || child.exitCode !== null) throw report('stdout-ended');
        try {
          child.stdin.write(command + '\n', (error) => {
            if (error) {
              stdinFailed = true;
              refuse('stdin-error');
            }
            written = !error;
            if (written) writtenAt = Date.now();
          });
        } catch {
          stdinFailed = true;
          throw report('stdin-error');
        }
      }
      while (!failure && (!lines.length || !written) && !stdoutEnded && Date.now() < until)
        await wait(20);
      if (failure) throw report();
      if (!lines.length) throw report(stdoutEnded ? 'stdout-ended' : 'timeout');
      if (!written) throw report(stdoutEnded ? 'stdout-ended' : 'timeout');
      const frame = lines.shift();
      if (frame.at >= until || writtenAt >= until) throw report('timeout');
      const value = frame.value;
      if (value.command !== command) throw report('unexpected-response');
      nextCommand = command === 'ready' && short ? 'short' : null;
      return value;
    } finally {
      active = false;
    }
  };
  return {
    child,
    next() {
      if (!nextCommand) return Promise.reject(report('protocol-state'));
      return take(nextCommand, false);
    },
    command(mode) {
      if (short || nextCommand || !['sync', 'async'].includes(mode))
        return Promise.reject(report('protocol-state'));
      return take(mode, true);
    },
    async close() {
      closed = true;
      phase = 'close';
      expectedCommand = null;
      const until = Date.now() + 10000;
      try {
        child.stdin.end();
      } catch {
        stdinFailed = true;
        refuse('stdin-error');
      }
      while (!processClosed && Date.now() < until) await wait(20);
      if (!processClosed || processClosedAt >= until) throw report('close-unconfirmed');
      if (child.exitCode !== 0) throw report('exit-failed');
      if (failure && !failureReported) throw report();
    },
  };
}
import { StringDecoder } from 'node:string_decoder';
