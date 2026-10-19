# WinGet candidate manifests

`scripts/prepare-winget.cjs` prepares three **candidate manifests** from an
explicit local signed AEGIS release: version, default locale and installer YAML.
It uses Node built-ins and the existing release verifier. It performs no download,
installation, signing, registry inspection or submission.

The CLI trusts only `keys/aegis-release-pubkey.pub` in this checkout. There is no
CLI or environment option for a replacement key. The private importable test seam
accepts ephemeral fixture keys; it does not establish trusted AEGIS release evidence.

## Required inputs

Run `node scripts/prepare-winget.cjs --help` for the complete option contract.
Every value below must come from the release being prepared and independently
verified package metadata. The following PowerShell invocation uses caller-set
variables; it is not a manifest for an existing release:

```powershell
node scripts/prepare-winget.cjs `
  --dir "$ReleaseDirectory" --out "$NewCandidateDirectory" `
  --id "$PackageIdentifier" --version "$ReleaseVersion" --tag "$ReleaseTag" `
  --asset "$SignedInstallerFilename" --file "$DownloadedInstallerFilename" `
  --installer-url "$PublishedInstallerUrl" --arch "$VerifiedPayloadArchitecture" `
  --locale "$DefaultLocale" --publisher "$VerifiedPublisher" `
  --package-name "$VerifiedInstalledName" --license "$VerifiedLicense" `
  --description "$ShortDescription"
```

The release directory must contain `manifest.json`, `manifest.json.sig` and the
selected installer. `--asset` is the exact name in the signed manifest. `--file`
is the exact local downloaded filename and defaults to `--asset`. Renamed uploads
require an explicit `--file`; the generator does not guess GitHub's filename
rewrite. Both names must end in the exact version followed by `.exe`. The version
uses the supported AEGIS `major.minor.patch[-prerelease]` subset, and the tag must
be `aegis-v` followed by that version.

`--installer-url` must be an HTTPS GitHub release download URL whose decoded path
matches the signed `repository`, signed tag and exact `--file` name. Credentials,
query strings, fragments and alternate ports are rejected. This binding is a
consistency check on a supplied URL; the URL is never fetched. Releases without
an explicit signed GitHub repository are rejected by this bounded generator.

Supply the **payload architecture** from packaging/build evidence. An NSIS
bootstrap executable's PE architecture is insufficient to establish the payload
architecture. Publisher and package name should match the installed Add/Remove
Programs entries, as described in Microsoft's manifest guidance. Scope, registry
keys, product codes and AppsAndFeaturesEntries are omitted: this tool has no
verified registry evidence from which to populate them.

## Output and failure behavior

The output directory must be new and its parent must already exist. Existing
output, symlinks and junctions in input/output paths are rejected. Files are opened
exclusively and all generated scalar values are quoted; unknown fields, duplicate
CLI flags, control characters and oversized input metadata are rejected.
The signed manifest is limited to 1 MiB/256 assets, the signature text to 1 KiB,
and the selected installer to 1 byte through 2 GiB. Only the selected installer's
bytes are verified; other release assets are outside this candidate's check.

Input validation and signature/hash verification finish before output creation.
If a write fails, cleanup removes only closed files created by this invocation
whose identity still matches, then removes the directory only if empty. Unknown
or replaced entries are preserved. Keep the local input and output parent stable
during preparation; the script does not provide filesystem isolation against a
concurrent process that can replace directories under the same account.

Generated files are deterministic for identical inputs and contain a candidate
warning comment. Successful preparation means the local signed manifest was
authenticated and the selected local bytes matched its signed size and SHA-256.
It establishes no Authenticode, notarization, native sensor packaging, URL
availability, installation acceptance or completion of packaging workstream W10.

## Remaining release qualification

Before submission, independently fetch the published URL and compare its exact
bytes and SHA-256 with the authenticated release. Verify package identifier,
publisher, installed package name, license, locale, payload architecture and any
additional registry/scope metadata against actual release evidence. Run
`winget validate --manifest <candidate-directory>` with the intended WinGet
version, and qualify clean-machine install, upgrade from the supported previous
release and uninstall, including silent behavior. Review and submit the validated
manifests through the normal WinGet process only after those checks succeed.
This generator does not run or claim any of those steps.

The offline tests use synthetic bytes and ephemeral keys. They establish candidate
generation and rejection behavior; they do not execute an NSIS installer or prove
an actual release's metadata. No real release manifest is checked into this folder.

## Schema references

The generator emits the required fields of Microsoft's three-file manifest format
with `ManifestVersion: 1.12.0` and `InstallerType: nullsoft`. `InstallerSha256` is
the SHA-256 of the selected installer, not the detached manifest signature.
References checked for this implementation:

- [Microsoft manifest authoring guidance](https://learn.microsoft.com/en-us/windows/package-manager/package/manifest)
- [Version schema 1.12.0](https://github.com/microsoft/winget-cli/blob/master/schemas/JSON/manifests/v1.12.0/manifest.version.1.12.0.json)
- [Default locale schema 1.12.0](https://github.com/microsoft/winget-cli/blob/master/schemas/JSON/manifests/v1.12.0/manifest.defaultLocale.1.12.0.json)
- [Installer schema 1.12.0](https://github.com/microsoft/winget-cli/blob/master/schemas/JSON/manifests/v1.12.0/manifest.installer.1.12.0.json)

These references guide this bounded emitter. They do not replace WinGet validation
and repository submission checks for a particular candidate.
