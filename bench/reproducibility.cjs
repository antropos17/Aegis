#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { evaluateReproducibility, LIMITS } = require('./lib/reproducibility');
const { parseInput, ordinaryPath, readStable } = require('./lib/reproducibility-input');
const HELP =
  'Offline declared reproducibility arithmetic; no collection or qualification.\nUsage: node bench/reproducibility.cjs --input INPUT.json --output NEW.json\nInput: at most 1 MiB, exactly 3 planned runs, at most 64 cells.\nJSON numbers must use canonical JSON.stringify spelling: 1.0, 1e0 and -0 are refused.\nOutput: new file only, at most 4 MiB; sourceAuthenticated/collectionQualified/measurementAccepted remain false.\n';
let stage = 'usage';
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') process.stdout.write(HELP);
  else {
    if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output') throw new Error();
    stage = 'input-path';
    const input = ordinaryPath(args[1], false);
    stage = 'output-path';
    const output = ordinaryPath(args[3], true);
    stage = 'input-read';
    const bytes = readStable(input);
    stage = 'input-invalid';
    const result = evaluateReproducibility(parseInput(bytes));
    result.inputBytesSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const encoded = JSON.stringify(result) + '\n';
    if (Buffer.byteLength(encoded) > LIMITS.outputBytes) throw new Error();
    stage = 'output-path';
    const fd = fs.openSync(
      output,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    stage = 'output-write';
    try {
      fs.writeFileSync(fd, encoded);
    } finally {
      fs.closeSync(fd);
    }
    process.stdout.write('reproducibility: written; declarations remain unqualified\n');
  }
} catch {
  process.stderr.write(`reproducibility: ${stage}\n`);
  process.exitCode = {
    usage: 2,
    'input-path': 3,
    'input-read': 3,
    'input-invalid': 4,
    'output-path': 5,
    'output-write': 6,
  }[stage];
}
