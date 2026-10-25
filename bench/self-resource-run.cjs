'use strict';
const session = require('./lib/self-resource-session');
const HELP = `Usage: node bench/self-resource-run.cjs --run-id SAFE --duration-ms INTEGER --max-acquisition-us INTEGER --max-cpu-uncertainty-us INTEGER --out NEWDIR
Required: duration 1000..60000 ms in whole 1000 ms steps; acquisition 1..durationUs; CPU uncertainty 1..2*durationUs.
Only this Node process is sampled, on an end-exclusive idle/waiting schedule. No workload, PID, phase, command or profile input.
Retention uses a fresh ordinary local directory and at most 1 MiB across five fixed files. No source authentication or measurement/W8 acceptance.
Cancellation is cooperative; no hard wall deadline or external supervisor is supplied.
`;
const FLAGS = Object.freeze({
  '--run-id': 'runId',
  '--duration-ms': 'durationMs',
  '--max-acquisition-us': 'maxAcquisitionUs',
  '--max-cpu-uncertainty-us': 'maxCpuUncertaintyUs',
  '--out': 'out',
});
const MESSAGES = Object.freeze({
  2: 'input-invalid',
  3: 'acquisition-or-derivation-incomplete',
  4: 'source-unavailable-or-changed',
  5: 'output-refused',
  6: 'partial-bundle',
});
function parse(argv) {
  if (!Array.isArray(argv) || argv.length !== 10) throw new Error('input-invalid');
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i],
      value = argv[i + 1];
    if (
      typeof flag !== 'string' ||
      !Object.hasOwn(FLAGS, flag) ||
      typeof value !== 'string' ||
      Object.hasOwn(result, FLAGS[flag])
    )
      throw new Error('input-invalid');
    const key = FLAGS[flag];
    if (['durationMs', 'maxAcquisitionUs', 'maxCpuUncertaintyUs'].includes(key)) {
      if (!/^[1-9][0-9]{0,15}$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new Error('input-invalid');
      result[key] = Number(value);
    } else result[key] = value;
  }
  session.validateOptions(result);
  return result;
}
/** Run the explicit own-process CLI; importing this module acquires nothing. @param {string[]} argv CLI tokens. @returns {Promise<number>} Fixed documented exit code. @since unreleased */
async function main(argv) {
  if (Array.isArray(argv) && argv.length === 1 && argv[0] === '--help') {
    process.stdout.write(HELP);
    return 0;
  }
  let options;
  try {
    options = parse(argv);
  } catch {
    process.stderr.write('self-resource-run: input-invalid\n');
    return 2;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    const result = await session.runSelfResourceSession({ ...options, signal: controller.signal });
    const code = [0, 2, 3, 4, 5, 6].includes(result.exitCode) ? result.exitCode : 6;
    if (code === 0) process.stdout.write('self-resource-run: complete\n');
    else process.stderr.write(`self-resource-run: ${MESSAGES[code]}\n`);
    return code;
  } catch {
    process.stderr.write('self-resource-run: partial-bundle\n');
    return 6;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
module.exports = { main };
