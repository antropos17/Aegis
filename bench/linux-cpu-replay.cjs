'use strict';
const replay = require('./lib/linux-cpu-replay');
const HELP =
  'Usage: node bench/linux-cpu-replay.cjs --input DIR --out NEWDIR\nOffline fixed five-file Linux SELF CPU bundle validation and current-model replay. No collection or supplied code execution.\n';
const MESSAGES = {
  2: 'input-invalid',
  3: 'incomplete-or-recorded-nonpass',
  4: 'bundle-refused',
  5: 'output-refused',
  6: 'publication-failed',
  7: 'replay-unavailable',
};
/** Validate CLI tokens and invoke only the offline checker. @param {string[]} argv Tokens. @returns {Promise<number>} Fixed status. @since unreleased */
async function main(argv) {
  if (Array.isArray(argv) && argv.length === 1 && argv[0] === '--help') {
    process.stdout.write(HELP);
    return 0;
  }
  const o = {};
  try {
    if (!Array.isArray(argv) || argv.length !== 4) throw Error();
    for (let i = 0; i < 4; i += 2) {
      const key = argv[i] === '--input' ? 'input' : argv[i] === '--out' ? 'out' : null;
      if (!key || Object.hasOwn(o, key) || typeof argv[i + 1] !== 'string' || !argv[i + 1])
        throw Error();
      o[key] = argv[i + 1];
    }
    require('./lib/linux-cpu-replay-io').options(o);
  } catch {
    process.stderr.write('linux-cpu-replay: input-invalid\n');
    return 2;
  }
  let code;
  try {
    const result = await replay.replayLinuxCpu(o);
    code = [0, 2, 3, 4, 5, 6, 7].includes(result.exitCode) ? result.exitCode : 6;
  } catch {
    code = 6;
  }
  if (code !== 0) process.stderr.write(`linux-cpu-replay: ${MESSAGES[code]}\n`);
  return code;
}
if (require.main === module)
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
module.exports = { main };
