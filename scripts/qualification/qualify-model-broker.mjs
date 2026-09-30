import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createModelFixture, OUTPUT } from './model-broker-fixture.mjs';
import { createModelOwner } from './model-broker-owner.mjs';
const modes = Object.freeze([
  'json',
  'sse',
  'tls',
  'secret-sse',
  'lost-response',
  'replay',
  'revoked',
  'route',
  'persist',
  'quota',
]);

/** Run one generated, credential-free model qualification with independent delivery counters.
 * @param {string} mode Fixed dummy-only scenario.
 * @returns {Promise<object>} Metadata only; no model text, route, credential or request digest. @since v0.17.0 */
export async function qualifyModelBroker(mode) {
  if (!modes.includes(mode)) throw Error('model-qualification-mode-invalid');
  const fixture = await createModelFixture({
    secure: mode === 'tls',
    mode:
      mode === 'secret-sse'
        ? 'sse-secret-chunks'
        : mode === 'sse'
          ? 'sse'
          : mode === 'lost-response'
            ? mode
            : 'json',
  });
  let owner, next;
  try {
    owner = await createModelOwner(
      fixture,
      mode === 'persist'
        ? (ledger) => ({
            ...ledger,
            consume: async () => {
              throw Error('dummy-persistence-failure');
            },
          })
        : undefined,
    );
    const attempt = owner.prepare();
    if (mode === 'revoked') owner.authority.revoke();
    if (mode === 'route') await fs.appendFile(fixture.endpointPath, ' ');
    let quotaRejected = true;
    if (mode === 'quota') {
      for (let i = 1; i < 16; i++) owner.prepare();
      quotaRejected = false;
      try {
        owner.prepare();
      } catch {
        quotaRejected = true;
      }
      owner.close();
    }
    const result = await owner.broker.request(attempt.capability, attempt.prepared);
    const observed = await owner.ledger.inspect(attempt.id);
    let replayRefused = true;
    if (['replay', 'secret-sse', 'lost-response'].includes(mode)) {
      owner.close();
      next = await createModelOwner(fixture);
      const replay = next.prepare(attempt.id);
      replayRefused =
        (await next.broker.request(replay.capability, replay.prepared)).state === 'refused';
    }
    const expected = ['json', 'sse', 'tls', 'replay'].includes(mode)
      ? 'completed'
      : ['secret-sse', 'lost-response', 'route'].includes(mode)
        ? 'outcome-unknown'
        : 'refused';
    const deliveries = ['revoked', 'route', 'persist', 'quota'].includes(mode) ? 0 : 1;
    const outputReleased = Object.hasOwn(result, 'text');
    const passed =
      result.state === expected &&
      fixture.state.deliveries === deliveries &&
      replayRefused &&
      quotaRejected &&
      (expected === 'completed'
        ? result.text === OUTPUT &&
          observed.state === 'completed' &&
          fixture.state.authorized === 1 &&
          fixture.state.requestMatches &&
          fixture.state.spentBeforeDelivery
        : !outputReleased);
    return Object.freeze({
      schemaVersion: 1,
      developerOnly: true,
      launchAllowed: false,
      mode,
      passed,
      state: result.state,
      recoveredState: observed.state,
      deliveries: fixture.state.deliveries,
      authorizedDeliveries: fixture.state.authorized,
      outputReleased,
      replayRefused,
      quotaRejected,
    });
  } finally {
    next?.close();
    owner?.close();
    await fixture.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (
      process.argv.length > 3 ||
      (process.argv[2] && process.argv[2] !== 'all' && !modes.includes(process.argv[2]))
    )
      throw Error('invalid');
    const results = [];
    for (const mode of process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : modes)
      results.push(await qualifyModelBroker(mode));
    const passed = results.every((result) => result.passed);
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        developerOnly: true,
        launchAllowed: false,
        passed,
        results,
      }) + '\n',
    );
    process.exitCode = passed ? 0 : 2;
  } catch {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        developerOnly: true,
        launchAllowed: false,
        passed: false,
        error: 'model-qualification-unavailable',
      }) + '\n',
    );
    process.exitCode = 2;
  }
}
