'use strict';
const reference = require('./lib/linux-own-cpu-reference');
const HELP = `Usage: node bench/linux-own-cpu-qualify.cjs --run-id SAFE --out NEWDIR
Linux-only fixed SELF CPU API corroboration with /proc/self/stat, discovered CLK_TCK and a fixed bounded inert LCG burst.
No arbitrary PID, command, path, workload or quantization tolerances. RSS/product/overhead/calibration/W8 acceptance remain unqualified.
`;
const MESSAGES = Object.freeze({
  2: 'input-invalid',
  3: 'insufficient-or-incomplete',
  4: 'reference-refused',
  5: 'output-refused',
  6: 'partial-bundle',
  7: 'unsupported-or-unavailable',
});
function parse(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) throw Error();
  const options = {};
  for (let i = 0; i < 4; i += 2) {
    const key = argv[i] === '--run-id' ? 'runId' : argv[i] === '--out' ? 'out' : null;
    if (!key || Object.hasOwn(options, key) || typeof argv[i + 1] !== 'string') throw Error();
    options[key] = argv[i + 1];
  }
  reference.validateOptions(options);
  return options;
}
/** Execute only the fixed Linux SELF contract. @param {string[]} argv CLI tokens. @returns {Promise<number>} Fixed result code. @since unreleased */
async function main(argv) {
  if (Array.isArray(argv) && argv.length === 1 && argv[0] === '--help') {
    process.stdout.write(HELP);
    return 0;
  }
  let options;
  try {
    options = parse(argv);
  } catch {
    process.stderr.write('linux-own-cpu-qualify: input-invalid\n');
    return 2;
  }
  const controller = new AbortController(),
    cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    const result = await reference.runLinuxOwnCpuReference({
      ...options,
      signal: controller.signal,
    });
    const code = [0, 2, 3, 4, 5, 6, 7].includes(result.exitCode) ? result.exitCode : 6;
    if (code === 0)
      process.stdout.write('linux-own-cpu-qualify: consistent-under-declared-model\n');
    else process.stderr.write(`linux-own-cpu-qualify: ${MESSAGES[code]}\n`);
    return code;
  } catch {
    process.stderr.write('linux-own-cpu-qualify: partial-bundle\n');
    return 6;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
if (require.main === module)
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
module.exports = { main };
