'use strict';

const { importStaticReport } = require('./static-report-import');
const ERRORS = new Set([
  'external-format-unsupported',
  'external-report-unsupported-shape',
  'external-baseline-invalid',
  'unsupported-profile',
]);

/** Handle explicit offline result import before Electron starts. @param {string[]} args @param {(value:string)=>void} write @returns {Promise<number|null>} 2 review required, 1 invalid/unavailable. @since v0.15.1 */
async function handleStaticImportCLI(args, write) {
  if (args[0] !== '--static-import-json') return null;
  const emit = (value) =>
    write(JSON.stringify({ safety: 'not-determined', reviewRequired: true, ...value }, null, 2));
  const baseline = args.length === 7 && args[5] === '--baseline';
  if (
    (!baseline && args.length !== 5) ||
    args.slice(1, 5).some((arg) => !arg || arg.startsWith('--')) ||
    (baseline && (!args[6] || args[6].startsWith('--')))
  ) {
    emit({ error: 'expected-static-import-arguments' });
    return 1;
  }
  try {
    emit(
      await importStaticReport({
        adapter: args[1],
        directory: args[2],
        format: args[3],
        reportFile: args[4],
        baselineFile: baseline ? args[6] : undefined,
      }),
    );
    return 2;
  } catch (error) {
    emit({ error: ERRORS.has(error.message) ? error.message : 'external-input-unavailable' });
    return 1;
  }
}

module.exports = { handleStaticImportCLI };
