# Verifying an AEGIS release

## Beta update channel

The current source updater accepts signed `alpha`, `beta` and stable releases.
Beta installations accept newer beta or stable versions; stable installations
accept stable versions only. Alpha installations may advance to beta.
The published 0.17.0-alpha updater accepts no beta tags, so install the first
beta manually from its Windows installer after the verification below.

CI releases starting with `0.13.0-alpha` carry two extra files next to the installer. Older releases may lack them:

| File                | What it is                                                                    |
| ------------------- | ----------------------------------------------------------------------------- |
| `manifest.json`     | One row per asset CI uploaded: filename, SHA-256, byte length. Plus the tag, the commit, and the repository the build came from. |
| `manifest.json.sig` | A detached Ed25519 signature over the exact bytes of `manifest.json`, base64-encoded. |

The public key is committed in this repository at
[`keys/aegis-release-pubkey.pub`](../keys/aegis-release-pubkey.pub). The
CI signing step receives the matching private key through the
`AEGIS_RELEASE_SIGNING_KEY` GitHub Actions secret. The committed public key does
not establish who may hold additional copies of the private key.

## What the signature proves

A passing verification says exactly one thing:

> The bytes on your disk are the bytes that this repository's CI published under this
> key, and the list of hashes you checked them against has not been edited since it was
> signed.

That is useful against a mirror serving a modified installer, a corrupted or truncated
download, and an asset swapped on the Release after the fact.

## What it does not prove

- **Nothing about whether the code is safe.** A signature is a statement about origin
  and integrity, not about behaviour. A signed installer is signed, not audited.
- **Nothing about who controls the key.** The key lives in this repository, so anyone
  who can push to this repository can also replace the key. The signature ties a
  download to *this release pipeline*, not to a verified identity. For the same reason
  this document does not print the key's fingerprint: a fingerprint published beside the
  key it describes adds no independent check, because whoever could alter one could
  alter the other. If you need a stronger anchor, record the key's bytes yourself, out
  of band, the first time you use it, and compare on every later release.
- **Nothing about the build inputs.** The manifest records the commit the build ran
  from. It is not a reproducible-build attestation: re-running the build does not
  produce a byte-identical installer, and nothing here claims it does.
- **Nothing about assets CI did not upload.** GitHub attaches auto-generated
  `Source code (zip)` and `Source code (tar.gz)` archives to every Release. They are
  produced by GitHub, not by this pipeline, and they are not covered by the manifest.
  The verifier lists them as "present but NOT covered by the manifest".

## Verifying a download

Download the installer, `manifest.json` and `manifest.json.sig` from the same Release
into one directory. Then, from a checkout of this repository:

```bash
node scripts/release-verify.js --dir /path/to/downloads
```

Exit code 0 with `OK - N asset(s) match the signed manifest` means the check passed. Any
mismatch prints a plain reason and exits nonzero. No network access, no dependencies
beyond Node itself.

To check one file without downloading the rest of the set:

```bash
node scripts/release-verify.js \
  --file "/path/to/AEGIS.-.AI.Monitoring.Threat.Detection.Setup.0.13.0-alpha.exe" \
  --manifest /path/to/manifest.json
```

`scripts/release-verify.js` and `keys/aegis-release-pubkey.pub` are the only two files
you need. They can be copied out of the repository and used on their own, as long as
`--pubkey` points at the key:

```bash
node release-verify.js --dir /path/to/downloads --pubkey /path/to/aegis-release-pubkey.pub
```

### Filenames change on upload; content does not

GitHub rewrites an asset's filename when it is attached to a Release. The 0.12.0-alpha
installer was built as

```
AEGIS - AI Monitoring & Threat Detection Setup 0.12.0-alpha.exe
```

and published as

```
AEGIS.-.AI.Monitoring.Threat.Detection.Setup.0.12.0-alpha.exe
```

The manifest records the name as built. The verifier therefore looks for the recorded
name first and, failing that, for any file whose SHA-256 matches a manifest row —
reporting the name it was actually found under. The exact rewriting rule GitHub applies
is not documented, so this verifier does not reimplement a guess at it. A renamed
download is still the signed bytes; the filename never carried any of the security.

## Verifying without running our code

The signature is a raw Ed25519 signature over the manifest bytes and the key is a
standard SPKI PEM, so OpenSSL 1.1.1 or newer can check it directly:

```bash
base64 -d manifest.json.sig > manifest.sig.bin
openssl pkeyutl -verify \
  -pubin -inkey keys/aegis-release-pubkey.pub \
  -rawin -in manifest.json \
  -sigfile manifest.sig.bin
```

`Signature Verified Successfully` means the manifest is authentic. Then check an asset
against the hash the manifest records for it:

```bash
sha256sum "AEGIS.-.AI.Monitoring.Threat.Detection.Setup.0.13.0-alpha.exe"
```

and compare that digest with the matching `sha256` field in `manifest.json`.

## If verification fails

`SIGNATURE CHECK FAILED` means `manifest.json` was not signed by this key, or its bytes
changed after signing — including a change as small as re-saving the file with different
line endings. `HASH MISMATCH` or `SIZE MISMATCH` means the manifest is authentic but the
asset next to it is not the file that was signed. `MISSING` means no file in the
directory carries the recorded hash at all — and when some file in the directory matches
no manifest row either, the verifier adds a `NOTE` line naming it, because a download
that was renamed on upload *and* altered afterwards shows up as exactly that pair.

In every one of those cases, do not run the installer. Re-download from the Release page
and check again; if it still fails, open an issue with the output.

## Offline WinGet candidate preparation

`node scripts/prepare-winget.cjs --help` describes an offline generator for three
candidate WinGet manifests. It reuses this release verifier to authenticate the
local manifest with the repository public key and check the explicitly selected
installer's bytes. Its URL checks bind caller-supplied GitHub repository/tag/file
metadata without fetching that URL. Publisher, package metadata and payload
architecture remain explicit caller inputs; registry/scope values are omitted.
See [the WinGet preparation guide](../packaging/winget/README.md) for inputs,
output ownership and remaining download, metadata, WinGet validation and
clean-machine install/upgrade/uninstall qualification. Candidate preparation
does not establish Authenticode signing or complete packaging workstream W10.

## Windows Authenticode prerequisite

`node scripts/verify-authenticode.cjs --help` describes a read-only gate for one
owner-selected local EXE. It requires the expected SHA-256 of the complete file
and the expected SHA-256 of the signer's DER-encoded certificate (`RawData`).
Obtain both pins independently from the owner-approved release/signing evidence.
The certificate pin is neither its usual SHA-1 thumbprint nor the Ed25519 release
public key. The tool discovers no expected pin and has no default signing key.

```powershell
node scripts/verify-authenticode.cjs `
  --artifact X:\owned-downloads\AEGIS-Setup.exe `
  --artifact-sha256 'REPLACE_WITH_OWNER_SUPPLIED_FILE_SHA256' `
  --signer-sha256 'REPLACE_WITH_OWNER_SUPPLIED_CERTIFICATE_DER_SHA256' `
  --output X:\owned-reports\new-authenticode-receipt.json
```

Use an ordinary, responsive local filesystem with trusted, stable directories
for the artifact, checkout, runtime and output parent. Supply absolute paths of
at most 240 characters. UNC/device paths, ADS syntax, dot segments, reserved
names, trailing dots/spaces, symlink/junction ancestors and artifact hardlinks
are refused. Drive mappings, mount configuration and concurrent privileged
filesystem changes are outside this contract. The EXE must have DOS/PE magic
and be between 68 bytes and 512 MiB; this check is not a full PE parser.
The output must be a new file under an existing owner-controlled parent.
Existing output is preserved. A refusal after output reservation may leave a
refusal, incomplete receipt, or even a pass-looking JSON file when the later
flush/close fails. A leftover file alone is never acceptance; retain it as
diagnostic evidence and require the successful CLI exit together with its receipt.

The CLI hashes the artifact before and after its fresh child observation and
compares file identity, size and change timestamps. The inbox Windows PowerShell
helper opens the same literal path with `FileShare.Read`, holds that stream
across its own two full hashes and `Get-AuthenticodeSignature`, and binds its
observation to the supplied artifact digest. This sharing mode denies ordinary
writes/deletes while the stream is held. Path checks and before/after comparisons
do not provide an atomic proof against a hostile filesystem or later changes.
The observed artifact must be preserved unchanged for subsequent qualification.

Pass requires the OS-reported status `Valid`, signature type `Authenticode`
(embedded), and the exact independently supplied certificate and artifact pins.
`Catalog` is refused, including a file for which Windows chooses a catalog over
an embedded signature. Only exit 0 together with the matching complete receipt
confirms success, including receipt flush/close. The JSON has a closed schema,
fixed refusal codes, hashes, byte count, observed enums, `timestampPresent`,
`checkedAt` and `childCleanup`; it contains no paths, subjects or provider errors.
Malformed arguments exit 2 with `INVALID_ARGUMENTS`; verification refusals exit 1.

The child uses `-NoLogo -NoProfile -NonInteractive -File`, an inbox-only
`PSModulePath`, a 30-second deadline, 4096 combined stdout/stderr bytes and a
two-second drain/termination grace. Absolute monotonic deadlines are checked
when output, exit and close are observed, including delayed event-loop turns;
unavailable or regressing clocks fail closed. Startup, policy denial, unknown/truncated
output, excess output and timeout fail closed. `childCleanup: unconfirmed` means
close was not observed within the grace: the gate refuses and cannot certify
that the child is gone. These limits cover the owned child; synchronous local
filesystem access relies on the responsive filesystem contract above. The tool
does not explicitly change execution policy, existing permissions,
trust/configuration stores, credentials or profiles. Normal Windows trust/cache/network effects
during signature verification are unmeasured.
The selected EXE is never launched.

`Valid` is the local cmdlet's result under the machine's current Windows policy,
clock, trust configuration and available cache/network state. This tool adds no
fresh online revocation requirement, independent certificate-chain validation,
publisher authorization or policy attestation. `timestampPresent` records only
whether Windows returned a timestamp authority certificate; timestamp presence
is not required by this gate and its time, algorithm, authority and validity are
not independently qualified. An expired signing certificate may remain valid
under Windows timestamp semantics. Review the signing and timestamp policy
separately for the intended release environment.

See Microsoft's [cmdlet contract](https://learn.microsoft.com/powershell/module/microsoft.powershell.security/get-authenticodesignature?view=powershell-5.1),
[signature types](https://learn.microsoft.com/dotnet/api/system.management.automation.signaturetype),
[status enum](https://learn.microsoft.com/dotnet/api/system.management.automation.signaturestatus),
[sharing modes](https://learn.microsoft.com/dotnet/api/system.io.fileshare)
and [timestamp semantics](https://learn.microsoft.com/windows/win32/seccrypto/time-stamping-authenticode-signatures).
The gate supplies one W10 prerequisite. Ed25519 manifest verification, candidate
WinGet YAML, published-download validation, payload/publisher metadata,
clean-machine install/upgrade/uninstall and submission remain separate evidence.
Modeled success tests and an actual unsigned-PE refusal do not qualify a signed
release; that requires an independently pinned real signed artifact.

## Combined Windows candidate verification

`node scripts/verify-windows-candidate.cjs --help` joins the signed release
manifest and a fresh Authenticode observation for one explicitly selected local
EXE. Supply the manifest, detached signature, exact signed asset filename,
expected tag/repository, artifact path and independently approved artifact and
certificate-DER SHA-256 pins. Only the checkout's
`keys/aegis-release-pubkey.pub` is accepted; CLI and environment key overrides
are unsupported. A renamed local artifact is allowed because the explicit
signed asset selection is bound by size and complete-file digest.

```powershell
node scripts/verify-windows-candidate.cjs `
  --manifest X:\owned-downloads\manifest.json `
  --signature X:\owned-downloads\manifest.json.sig `
  --asset 'EXACT_SIGNED_INSTALLER_FILENAME.exe' `
  --tag 'aegis-vREPLACE_WITH_EXPECTED_VERSION' `
  --repository 'OWNER/REPOSITORY' `
  --artifact X:\owned-downloads\AEGIS-Setup.exe `
  --artifact-sha256 'REPLACE_WITH_OWNER_SUPPLIED_FILE_SHA256' `
  --signer-sha256 'REPLACE_WITH_OWNER_SUPPLIED_CERTIFICATE_DER_SHA256' `
  --authenticode-output X:\owned-reports\new-candidate-authenticode.json `
  --output X:\owned-reports\new-candidate-combined.json
```

All input/output paths must be distinct ordinary absolute local paths with
trusted, stable ancestors and existing owner-controlled output parents. The
component's path restrictions and 68-byte..512-MiB artifact bound apply; the
manifest is limited to 2 MiB and the detached signature to 256 bytes. Existing
outputs, including imported passing receipts, are refused and preserved.
Duplicate manifest filenames, including case-only aliases, are refused.

The combined pass binds the SHA-256 of the exact authenticated manifest bytes,
expected tag/repository, selected signed filename, signed size/digest, independent
artifact pin and the new component receipt's complete bytes and SHA-256. It
requires a fresh `Valid` embedded Authenticode observation under the supplied
certificate pin, observed helper close, successful component receipt flush/close,
and a final stable artifact hash/size check. Both receipt paths must be new;
there is no receipt-import option. The component retains its 30-second helper
deadline, 4096-byte output limit and two-second cleanup grace. All filesystem
operations rely on the same responsive trusted-filesystem boundary.

Signature/schema refusals use the existing release verifier's diagnostics and
exit nonzero before any new receipt reservation or helper launch. Other early
refusals also may produce no receipt. New failures use fixed codes:
`RELEASE_IDENTITY`, `AMBIGUOUS_ASSET`, `ASSET_MISSING`, `SIGNED_PIN_MISMATCH`,
`SIGNED_SIZE_MISMATCH`, `AUTHENTICODE_REFUSED`, `AUTHENTICODE_BINDING`,
`AUTHENTICODE_RECEIPT` and `ARTIFACT_CHANGED`, alongside input/path/output
refusals. `AUTHENTICODE_REFUSED` leaves the component's reason in its fresh
receipt when one was written. The combined JSON contains no local paths.

Acceptance requires exit 0, combined `CANDIDATE_VERIFIED`, and both complete
matching fresh receipts. Failed writes, flushes or closes may leave incomplete
or pass-looking JSON; the CLI's failed exit always defeats such a file. Preserve
both receipts and the unchanged candidate artifact for later qualification.
`launchAllowed` remains `false` on success. This command performs no fetching,
WinGet YAML preparation, metadata inference, installation, signing or target
execution. Local trust/cache, revocation and timestamp limits remain those of
the [component gate](#windows-authenticode-prerequisite). Candidate success
does not establish published-download identity, payload/publisher metadata,
WinGet validation, clean-machine install/upgrade/uninstall, submission, W10
completion or release acceptance. Modeled tests establish the verification
contract; they do not establish a real signed release's qualification.

## Release notes

`release-please-config.json` uses `changelog-type: github`: GitHub generates the
notes from merged pull requests between release tags. The default commit-based
builder listed both a feature commit and its conventional merge commit, producing
duplicate entries with this repository's merge-only workflow.

New release sections use GitHub's PR list, contributor credits and comparison link.
They include maintenance and test PRs too; the former commit-type sections and hidden
types no longer apply. Existing released sections of `CHANGELOG.md` are preserved.
Conventional commits still determine the version bump. Review the generated notes
on the final release PR head before approving CI or publishing.

This is the built-in
[GitHub changelog builder](https://github.com/googleapis/release-please/blob/v17.6.0/docs/customizing.md#changelog-types),
not a custom post-processing step.

## How the signature is produced

`.github/workflows/release-build.yml` runs on every published Release and on the
release-please path:

1. It refuses to start unless `AEGIS_RELEASE_SIGNING_KEY` is available to the job.
   Publication requires a signed manifest covering the installer. This Ed25519
   manifest signature is separate from Windows Authenticode code signing; it does
   not make the executable an Authenticode-signed application.
2. It builds the installer and stages exactly the files that will be uploaded.
3. `scripts/release-sign.js` writes `manifest.json` and signs its bytes.
4. `scripts/release-verify.js` re-checks that manifest against the **public** key
   committed in this repository, before anything is uploaded. A secret that does not
   pair with the committed key stops the release there rather than publishing a manifest
   nobody could verify.
5. Only then are the installer, the manifest and the signature uploaded together.
