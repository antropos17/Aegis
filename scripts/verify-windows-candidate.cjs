#!/usr/bin/env node
/* global process */
'use strict';

const { verify, parse } = require('./lib/windows-candidate.js');
const HELP = `usage: node scripts/verify-windows-candidate.cjs [options]
Read-only combined Windows candidate gate. Required flags, each exactly once:
  --manifest ABS_JSON             Local signed release manifest, at most 2 MiB
  --signature ABS_SIG             Its detached base64 Ed25519 signature
  --asset NAME                    Exact selected .exe filename in that manifest
  --tag TAG                       Exact expected signed aegis-v release tag
  --repository OWNER/REPO          Exact expected signed repository identity
  --artifact ABS_EXE              Owner-selected local file, 68 bytes..512 MiB
  --artifact-sha256 HEX            Independently supplied complete-file SHA-256
  --signer-sha256 HEX              Independently supplied certificate-DER SHA-256
  --authenticode-output ABS_JSON   New component receipt in an owned existing parent
  --output ABS_JSON                New combined receipt in an owned existing parent
  --help                          Show this help alone
Only keys/aegis-release-pubkey.pub is trusted; no CLI/environment key override.
All paths must be ordinary absolute local paths (max 240 characters), without
reparse ancestors, hardlinks, ADS, aliases or collisions. Inputs/checkout/output
parents must remain trusted and stable on a responsive filesystem.
Pass binds exact authenticated manifest bytes, tag/repository, selected signed
size/hash, independent file pin and a fresh Windows embedded Authenticode result
under the supplied certificate pin. Existing receipts are never imported.
The inbox no-profile helper has 30 s, 4096 output bytes and 2 s cleanup grace.
No downloads, YAML generation, target execution, signing or explicit trust/configuration
writes occur. Normal Windows cache/network effects are unmeasured.
Local Windows policy/cache observations and timestamp presence retain their
component limits. Candidate success does not complete W10 or release acceptance;
launchAllowed remains false. Preserve the artifact and both fresh receipts.
Exit 0 plus matching complete receipts is required: failed flush/close can leave
pass-looking JSON. Refusal exits 1; invalid arguments exit 2. Signature/schema
refusals occur before receipts/helper launch, using release-verify diagnostics.
`;

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
