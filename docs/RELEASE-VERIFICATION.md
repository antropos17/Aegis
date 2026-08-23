# Verifying an AEGIS release

Every GitHub Release built by CI carries two extra files next to the installer:

| File                | What it is                                                                    |
| ------------------- | ----------------------------------------------------------------------------- |
| `manifest.json`     | One row per asset CI uploaded: filename, SHA-256, byte length. Plus the tag, the commit, and the repository the build came from. |
| `manifest.json.sig` | A detached Ed25519 signature over the exact bytes of `manifest.json`, base64-encoded. |

The public key is committed in this repository at
[`keys/aegis-release-pubkey.pub`](../keys/aegis-release-pubkey.pub). The matching
private key exists only as the `AEGIS_RELEASE_SIGNING_KEY` GitHub Actions secret; it is
not on any developer machine and is never written to the build workspace.

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
directory carries the recorded hash at all.

In every one of those cases, do not run the installer. Re-download from the Release page
and check again; if it still fails, open an issue with the output.

## How the signature is produced

`.github/workflows/release-build.yml` runs on every published Release and on the
release-please path:

1. It refuses to start unless `AEGIS_RELEASE_SIGNING_KEY` is available to the job. There
   is no code path that publishes an unsigned installer.
2. It builds the installer and stages exactly the files that will be uploaded.
3. `scripts/release-sign.js` writes `manifest.json` and signs its bytes.
4. `scripts/release-verify.js` re-checks that manifest against the **public** key
   committed in this repository, before anything is uploaded. A secret that does not
   pair with the committed key stops the release there rather than publishing a manifest
   nobody could verify.
5. Only then are the installer, the manifest and the signature uploaded together.
