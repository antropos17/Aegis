import fs from 'node:fs';
import { crashProvider } from './claude-crash-evidence.mjs';
/** Build a bounded provider stream interaction; private paths stay in this closure.
 * @param {object} context Fixture state. @returns {Function} Child interaction. @since v0.15.1 */
export function cancellationInteraction(context) {
  const { e, catalog, state, markers, witnessFile, frame, bytes, until, pause, identity } = context;
  return async (child) => {
    let buffer = '',
      initialized = false,
      closed = false;
    child.once('close', () => {
      closed = true;
    });
    const receive = (chunk) => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > 32768) {
        e.failure = 'stream-limit';
        child.stdin.end();
        return;
      }
      while (buffer.includes('\n')) {
        const at = buffer.indexOf('\n');
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        try {
          const m = JSON.parse(line);
          if (m.type === 'control_response' && m.response?.subtype === 'success') {
            if (m.response.request_id === 'fixture-init') initialized = true;
            if (m.response.request_id === 'fixture-interrupt') e.interruptAcknowledged = true;
          }
          if (m.type === 'result')
            e.providerResult = {
              subtype: ['success', 'error_during_execution', 'error_max_turns'].includes(m.subtype)
                ? m.subtype
                : 'unexpected',
              isError: m.is_error === true,
            };
        } catch {
          e.failure = 'stream-invalid';
        }
      }
    };
    child.stdout.on('data', receive);
    const send = (value) => {
      if (closed || child.stdin.destroyed) throw Error('provider-closed');
      child.stdin.write(JSON.stringify(value) + '\n');
    };
    try {
      send({
        type: 'control_request',
        request_id: 'fixture-init',
        request: { subtype: 'initialize', hooks: {} },
      });
      await until(() => initialized || closed, 10000);
      if (!initialized || closed) throw Error('initialize');
      send({
        type: 'user',
        message: { role: 'user', content: 'Invoke the selected local fixture action once.' },
      });
      await until(() => bytes(markers[1]) > 0 || closed, e.review ? 60000 : 15000);
      if (closed) throw Error('provider-closed');
      await until(() => frame(state.observer?.snapshot(), catalog, 1, 0, 0));
      e.pending = state.observer.snapshot();
      const first = bytes(markers[1]);
      await pause(125);
      e.progressObserved = first > 0 && bytes(markers[1]) > first;
      if (!e.progressObserved) throw Error('not-running');
      if (e.crash) {
        state.descriptor = fs.readFileSync(state.endpoint);
        await crashProvider({ child, identity, e, until });
        const last = bytes(markers[1]);
        await pause(200);
        e.progressStopped = last > 0 && bytes(markers[1]) === last;
        return;
      }
      send({
        type: 'control_request',
        request_id: 'fixture-interrupt',
        request: { subtype: 'interrupt' },
      });
      e.interruptSent = true;
      await until(
        () =>
          e.interruptAcknowledged &&
          frame(state.observer?.snapshot(), catalog, 1, 1, 1) &&
          fs.existsSync(witnessFile),
      );
      e.after = state.observer.snapshot();
      if (bytes(witnessFile) > 1024) throw Error('witness-limit');
      const w = JSON.parse(fs.readFileSync(witnessFile, 'utf8'));
      e.witness = {
        launches: Number.isSafeInteger(w.launches) ? w.launches : null,
        ...Object.fromEntries(
          ['exited', 'closed', 'cancelled', 'interrupted', 'terminationConfirmed'].map((k) => [
            k,
            w[k] === true,
          ]),
        ),
      };
      const last = bytes(markers[1]);
      await pause(200);
      e.progressStopped = last > 0 && bytes(markers[1]) === last;
      await until(() => !!e.providerResult);
    } catch {
      e.failure ||= 'interrupt-checkpoint-failed';
    } finally {
      child.stdout.removeListener('data', receive);
      if (!child.stdin.destroyed) child.stdin.end();
    }
  };
}
