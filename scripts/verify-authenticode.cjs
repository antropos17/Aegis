#!/usr/bin/env node
/* global process */
'use strict';

const { verify } = require('./lib/authenticode.js');
const HELP = `usage: node scripts/verify-authenticode.cjs [options]
Read-only Windows Authenticode prerequisite for one explicitly selected EXE.
Required options (each exactly once):
  --artifact ABS_EXE           Existing local EXE, 68 bytes..512 MiB
  --artifact-sha256 HEX        Expected SHA-256 of its complete file bytes
  --signer-sha256 HEX          Expected SHA-256 of signer certificate DER bytes
  --output ABS_NEW_JSON        New receipt file; owned parent must already exist
  --help                      Show this help alone
Pins must be 64 lowercase hexadecimal characters supplied independently by the
owner. No pin discovery, default certificate, target execution or signing occurs.
Use ordinary absolute paths (max 240 characters) in trusted stable directories;
UNC, device, ADS, reparse, hardlink and ambiguous path aliases are refused.
The inbox Windows PowerShell child runs without profiles or interaction. Existing
execution policy applies. Timeout: 30 s; combined output: 4096 bytes; drain: 2 s.
Pass requires status Valid, embedded Authenticode, both exact pins, stable bytes
and observed helper close. The JSON receipt contains no paths or error details.
This observes local Windows policy/cache state; fresh online revocation, timestamp
qualification, installer safety, WinGet acceptance and W10 completion remain separate.
Exit 0: verified and receipt written. Exit 1: refused. Exit 2: invalid CLI arguments.
`;

/** Parse the closed CLI argument set without echoing caller data.
 * @param {string[]} args CLI argument vector.
 * @returns {object|null} Explicit options, or null for invalid arguments.
 * @since 0.19.2-beta
 */
function parse(args) {
  const names = {
    '--artifact': 'artifact',
    '--artifact-sha256': 'artifactSha256',
    '--signer-sha256': 'signerSha256',
    '--output': 'output',
  };
  if (args.length !== 8) return null;
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = Object.hasOwn(names, args[i]) ? names[args[i]] : null;
    if (!name || Object.hasOwn(options, name) || !args[i + 1] || args[i + 1].startsWith('--'))
      return null;
    options[name] = args[i + 1];
  }
  return options;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') process.stdout.write(HELP);
  else {
    const options = parse(args);
    if (!options) {
      process.stdout.write('{"schemaVersion":1,"verdict":"refused","code":"INVALID_ARGUMENTS"}\n');
      process.exitCode = 2;
    } else {
      verify(options)
        .then((result) => {
          process.stdout.write(JSON.stringify(result) + '\n');
          process.exitCode = result.verdict === 'pass' ? 0 : 1;
        })
        .catch(() => {
          process.stdout.write(
            '{"schemaVersion":1,"verdict":"refused","code":"VERIFICATION_FAILED"}\n',
          );
          process.exitCode = 1;
        });
    }
  }
}

module.exports = { parse };
