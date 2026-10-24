'use strict';
const replay = require('./lib/resource-replay');
const HELP = `Usage: node bench/resource-session-replay.cjs --input DIR --out NEWDIR
Offline inspection of exactly three supervision files and five capture/ session files.
No producer, child process or supplied source code is executed. Output must be fresh and cannot overlap input.
Structural consistency and current conditional arithmetic do not authenticate sources, publication, measurements or W8 acceptance.
`;
const MESSAGES = Object.freeze({
  2: 'input-invalid',
  3: 'incomplete',
  4: 'bundle-refused',
  5: 'output-refused',
  6: 'partial-report',
  7: 'replay-unavailable',
});
function parse(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) throw Error();
  const options = {};
  for (let i = 0; i < 4; i += 2) {
    const key = argv[i] === '--input' ? 'input' : argv[i] === '--out' ? 'out' : null;
    if (!key || Object.hasOwn(options, key) || typeof argv[i + 1] !== 'string') throw Error();
    options[key] = argv[i + 1];
  }
  replay.options(options);
  return options;
}
/** Inspect only explicit offline files; import/help/invalid arguments perform no IO. @param {string[]} argv CLI tokens. @returns {Promise<number>} Fixed result. @since unreleased */
async function main(argv) {
  if (Array.isArray(argv) && argv.length === 1 && argv[0] === '--help') {
    process.stdout.write(HELP);
    return 0;
  }
  let options;
  try {
    options = parse(argv);
  } catch {
    process.stderr.write('resource-session-replay: input-invalid\n');
    return 2;
  }
  try {
    const result = await replay.inspectResourceReplay(options);
    const code = [0, 2, 3, 4, 5, 6, 7].includes(result.exitCode) ? result.exitCode : 6;
    if (code === 0) process.stdout.write('resource-session-replay: consistent\n');
    else process.stderr.write(`resource-session-replay: ${MESSAGES[code]}\n`);
    return code;
  } catch {
    process.stderr.write('resource-session-replay: partial-report\n');
    return 6;
  }
}
if (require.main === module)
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
module.exports = { main };
