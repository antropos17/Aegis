'use strict';

const { scanStaticDirectory } = require('./static-analysis');
const CATALOG_ERRORS = new Set(['tool-catalog-invalid', 'tool-catalog-unavailable']);

/**
 * Run explicit offline static review before Electron starts.
 * @param {string[]} args CLI flag, adapter, directory and optional explicit tools file.
 * @param {(value: string) => void} write Output sink.
 * @returns {Promise<number|null>} 0 no findings in the declared subset, 2 review needed, 1 error.
 * @since v0.15.1
 */
async function handleStaticAnalysisCLI(args, write) {
  if (args[0] !== '--static-scan-json') return null;
  const emit = (value) => write(JSON.stringify(value, null, 2));
  const hasTools = args.length === 5 && args[3] === '--tools-file';
  const invalid = (arg) => typeof arg !== 'string' || !arg || arg.startsWith('--');
  if (
    (!hasTools && args.length !== 3) ||
    args.slice(1, 3).some(invalid) ||
    (hasTools && invalid(args[4]))
  ) {
    emit({
      error: 'expected-static-scan-arguments',
      safety: 'not-determined',
      reviewRequired: true,
    });
    return 1;
  }
  try {
    const result = await scanStaticDirectory(args[1], args[2], {
      toolsFile: hasTools ? args[4] : undefined,
    });
    emit(result);
    return result.reviewRequired ? 2 : 0;
  } catch (error) {
    emit({
      error:
        error.message === 'unsupported-profile'
          ? 'unsupported-static-adapter'
          : CATALOG_ERRORS.has(error.message)
            ? error.message
            : 'static-scan-unavailable',
      safety: 'not-determined',
      reviewRequired: true,
    });
    return 1;
  }
}

module.exports = { handleStaticAnalysisCLI };
