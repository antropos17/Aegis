'use strict';
const supervisor = require('./lib/resource-supervisor');
const HELP = `Usage: node bench/self-resource-supervise.cjs --run-id SAFE --duration-ms INTEGER --max-acquisition-us INTEGER --max-cpu-uncertainty-us INTEGER --wall-limit-ms INTEGER --confirm-ms INTEGER --out NEWDIR
Supervises only the fixed own-Node resource CLI. Duration1000..60000ms step1000; explicit existing acquisition/CPU bounds; wall1..120000ms; confirmation1..10000ms.
Fresh outer directory; fixed capture/ child bundle; no arbitrary executable, PID, command, phase or environment options.
Limits depend on the parent's responsive event loop and filesystem. No OS containment, source authentication, measurement or W8 acceptance.
`;
const FLAGS = Object.freeze({
  '--run-id': 'runId',
  '--duration-ms': 'durationMs',
  '--max-acquisition-us': 'maxAcquisitionUs',
  '--max-cpu-uncertainty-us': 'maxCpuUncertaintyUs',
  '--wall-limit-ms': 'wallLimitMs',
  '--confirm-ms': 'confirmMs',
  '--out': 'out',
});
const MESSAGES = Object.freeze({
  2: 'input-invalid',
  3: 'supervision-failed',
  4: 'source-unavailable-or-changed',
  5: 'output-refused',
  6: 'partial-parent-bundle',
});
function parse(argv) {
  if (!Array.isArray(argv) || argv.length !== 14) throw Error();
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i],
      value = argv[i + 1];
    if (
      typeof flag !== 'string' ||
      !Object.hasOwn(FLAGS, flag) ||
      typeof value !== 'string' ||
      Object.hasOwn(options, FLAGS[flag])
    )
      throw Error();
    const key = FLAGS[flag];
    if (['runId', 'out'].includes(key)) options[key] = value;
    else {
      if (!/^[1-9][0-9]{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) throw Error();
      options[key] = Number(value);
    }
  }
  supervisor.validateOptions(options);
  return options;
}
/** Run the fixed-child supervisor; import/help/invalid input never spawns. @param {string[]} argv CLI tokens. @returns {Promise<number>} Fixed documented code. @since unreleased */
async function main(argv) {
  if (Array.isArray(argv) && argv.length === 1 && argv[0] === '--help') {
    process.stdout.write(HELP);
    return 0;
  }
  let options;
  try {
    options = parse(argv);
  } catch {
    process.stderr.write('self-resource-supervise: input-invalid\n');
    return 2;
  }
  const controller = new AbortController(),
    cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    const result = await supervisor.superviseSelfResources({
      ...options,
      signal: controller.signal,
    });
    const code = [0, 2, 3, 4, 5, 6].includes(result.exitCode) ? result.exitCode : 6;
    if (code === 0) process.stdout.write('self-resource-supervise: complete\n');
    else process.stderr.write(`self-resource-supervise: ${MESSAGES[code]}\n`);
    return code;
  } catch {
    process.stderr.write('self-resource-supervise: partial-parent-bundle\n');
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
