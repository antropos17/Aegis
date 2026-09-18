'use strict';

/**
 * Run opt-in finite observation or one hook send before Electron initialization.
 * @param {string[]} args CLI arguments.
 * @param {(text: string) => void} write CLI metadata output (unused by hook sender).
 * @returns {Promise<number>} Observation status; sender uses 0/1 with empty stdout.
 * @since v0.15.1
 */
async function handleHandoffLiveCLI(args, write) {
  const sender = args[0] === '--handoff-send';
  const expected = sender ? 1 : 4;
  const token = process.env.AEGIS_HANDOFF_TOKEN;
  const rawPort = sender ? process.env.AEGIS_HANDOFF_PORT : args[2];
  const port = typeof rawPort === 'string' && /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : -1;
  const seconds = !sender && /^\d{1,3}$/.test(args[3] || '') ? Number(args[3]) : 0;
  const { validToken, startHandoffCollector } = require('./handoff-live');
  if (
    args.length !== expected ||
    !validToken(token) ||
    port < (sender ? 1 : 0) ||
    port > 65535 ||
    (!sender && (args[1] !== 'claude-code' || seconds < 1 || seconds > 900))
  ) {
    if (!sender) write(JSON.stringify({ error: 'live-configuration-invalid' }));
    return 1;
  }
  if (sender) return require('./handoff-send').sendHandoffEvent(process.stdin, { port, token });
  let collector;
  const stop = () => {
    collector.close();
  };
  try {
    collector = await startHandoffCollector({ port, token, durationMs: seconds * 1000 });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    write(
      JSON.stringify({
        schemaVersion: 1,
        mode: 'handoff-live-ready',
        port: collector.port,
        durationSeconds: seconds,
        control: 'not-supported',
      }),
    );
    const report = await collector.done;
    write(JSON.stringify(report));
    return report.receiver.lossDetected ? 2 : 0;
  } catch (_) {
    if (collector) await collector.close();
    write(JSON.stringify({ error: 'live-listen-unavailable' }));
    return 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

module.exports = { handleHandoffLiveCLI };
