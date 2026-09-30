import { fileURLToPath } from 'node:url';
import { qualifyProviderReplay, assessProviderEvidence } from './provider-replay-evidence.mjs';
import { inspectInstalledProvider } from './provider-installed-probe.mjs';

/** Execute selected fixed adapter corpora; receipts never contain private wire bytes.
 * @param {string[]} args Fixed provider selector and optional explicit probe triple.
 * @returns {Promise<object>} Bounded metadata-only qualification receipt. @since v0.17.0 */
export async function qualifyProviderAdapters(args = []) {
  const provider = args[0] || 'all';
  if (
    !['all', 'claude', 'codex'].includes(provider) ||
    ![0, 1, 5].includes(args.length) ||
    (args.length === 5 && (provider === 'all' || args[1] !== '--probe'))
  )
    throw Error('provider-qualification-selector-invalid');
  const results = [];
  for (const selected of provider === 'all' ? ['claude', 'codex'] : [provider]) {
    const { report, proof } = await qualifyProviderReplay(selected);
    results.push({ report, evidence: assessProviderEvidence(report, report.binding, proof) });
  }
  const probe =
    args.length === 5
      ? await inspectInstalledProvider({
          provider,
          nativePath: args[2],
          wrapperPath: args[3],
          launcherPath: args[4],
        })
      : {
          result: 'not-selected',
          hostHookBehavior: 'not-run',
          authentication: 'not-run',
          launchAllowed: false,
        };
  const receipt = {
    schemaVersion: 1,
    developerOnly: true,
    launchAllowed: false,
    passed: results.every((result) => result.evidence.trustedFixtureObservation),
    probe,
    results,
  };
  if (Buffer.byteLength(JSON.stringify(receipt)) > 65536)
    throw Error('provider-qualification-output-budget');
  return Object.freeze(receipt);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = await qualifyProviderAdapters(process.argv.slice(2));
    process.stdout.write(JSON.stringify(report) + '\n');
    process.exitCode = report.passed ? 0 : 2;
  } catch {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        passed: false,
        developerOnly: true,
        launchAllowed: false,
        error: 'provider-qualification-unavailable',
      }) + '\n',
    );
    process.exitCode = 2;
  }
}
