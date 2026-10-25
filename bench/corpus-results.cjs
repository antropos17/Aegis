#!/usr/bin/env node
'use strict';
const { writeCorpusResults, LIMITS } = require('./lib/corpus-results');
const HELP =
  'Offline synthetic corpus artifact summary; no capture, discovery, subprocesses or scoring.\nUsage: node bench/corpus-results.cjs --run DIR [--run DIR...] --as-of YYYY-MM-DD --out NEWDIR\nAt most 24 runs; new directory only; bounded corpus-results.json and corpus-results.md.\nIncomplete artifacts and failed/skipped steps remain visible. Capture assessment is not-assessed; measurementAccepted=false; w8Accepted=false.\n';
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') process.stdout.write(HELP);
  else {
    const runs = [];
    let asOf, out;
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index],
        value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('corpus-usage');
      if (key === '--run' && runs.length < LIMITS.runs) runs.push(value);
      else if (key === '--as-of' && asOf === undefined) asOf = value;
      else if (key === '--out' && out === undefined) out = value;
      else throw new Error('corpus-usage');
    }
    if (!runs.length || asOf === undefined || out === undefined) throw new Error('corpus-usage');
    writeCorpusResults(runs, asOf, out);
    process.stdout.write('corpus-results: written\n');
  }
} catch (error) {
  const codes = {
    'corpus-usage': 2,
    'corpus-input-invalid': 3,
    'corpus-output-refused': 5,
    'corpus-output-partial': 6,
  };
  const code = Object.hasOwn(codes, error.message) ? error.message : 'corpus-input-invalid';
  process.stderr.write(`corpus-results: ${code}\n`);
  process.exitCode = codes[code];
}
