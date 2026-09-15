'use strict';

const { scanStaticDirectory } = require('./static-analysis');

/**
 * Run explicit offline static review before Electron starts.
 * @param {string[]} args CLI flag, adapter and directory.
 * @param {(value: string) => void} write Output sink.
 * @returns {Promise<number|null>} 0 no findings in the declared subset, 2 review needed, 1 error.
 * @since v0.15.1
 */
async function handleStaticAnalysisCLI(args, write) {
  if (args[0] !== '--static-scan-json') return null;
  const emit = (value) => write(JSON.stringify(value, null, 2));
  if (args.length !== 3 || args.slice(1).some((arg) => !arg || arg.startsWith('--'))) {
    emit({
      error: 'expected-static-scan-arguments',
      safety: 'not-determined',
      reviewRequired: true,
    });
    return 1;
  }
  try {
    const result = await scanStaticDirectory(args[1], args[2]);
    emit(result);
    return result.reviewRequired ? 2 : 0;
  } catch (error) {
    emit({
      error:
        error.message === 'unsupported-profile'
          ? 'unsupported-static-adapter'
          : 'static-scan-unavailable',
      safety: 'not-determined',
      reviewRequired: true,
    });
    return 1;
  }
}

module.exports = { handleStaticAnalysisCLI };
