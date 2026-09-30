# Sealed import evidence — 2026-09-30

Developer fixture evidence only. No scoped or A-gate verdict is issued here.
Full A1-A4 remain UNREVIEWED; production `launchAllowed=false`.

## Executed Windows observations

The final focused command was `npx vitest run tests/main/sealed-import-windows.test.js tests/main/sealed-import-contract.test.js --reporter=verbose`.
It ran from 00:50:49.9697026 to 00:50:57.5451435 UTC on 2026-09-30, exit 0:
27 tests passed, comprising 20 native tests and 7 portable contract/oracle tests,
with zero skips and 41 native scenario invocations. Focused ESLint exited 0.
All six fixed qualification CLI modes also exited 0; the actual native positive
exited 0 and each expected refusal exited 2. The positive used the independent
JavaScript byte/hash oracle.

The earlier compiled candidate passed the positive but failed four expectations:
actual same-byte replacement, same-size mutation, late ADS, and synthetic upper
identity bits were accepted without seal-time revalidation. Its exact four native
source files and RED test are preserved separately. The repaired implementation
reopens and retains leaves, checks full identities/size/hash/streams/link counts,
and reenumerates pinned directory membership before publication.

The final run also exercises real enumeration/open replacement, junction and
hardlink canaries, file/directory ADS, source content/membership/size changes,
writer-held refusal, retained write/delete/rename denial, real final-name
collision, exact quotas and refusal above them. API-unavailable, upper-ID,
stage corruption, forced publication failure and pending completion hooks are
explicit synthetic controls. Existing final collision bytes remain unchanged;
cleanup deletes the exact held stage, with uncertainty preserved on failure.

## Provenance and receipts

Windows kernel build 10.0.26200, x64; Node v24.11.1; npm 11.6.2; PowerShell 7.6.5;
inbox x64 csc 4.8.9221.0. Compiler SHA-256:
`46809206887326d2d24db1eff1f3064de972c3451abe766b49111450a5e08e00`.
The final measured executable SHA-256 is
`d90a58ac2c273b80c2e0f7e9115850ae9b9c7761031701762666ec02653b1d09`.

Diagnostic receipts remain outside Git in `X:/tmp/aegis-run-20260930/`:
`sealed-import-final-focused-command.json`, `sealed-import-final-focused.log`,
`sealed-import-final-native-receipt.json`, `sealed-import-cli-commands.json`,
six `sealed-import-cli-*.json` receipts, `sealed-import-real-stale-red*`,
`red-source/`, `sealed-import-final-measurements.json` and `tool-versions.json`.
The new draft's review packet must bind these raw Windows bytes to Git HEAD,
explicitly accounting for CRLF normalization. Native receipts contain no source
contents or user paths. Tool/check provenance is separately identified.

| Measured raw source | SHA-256 |
| --- | --- |
| `tests/fixtures/sealed-import/ImportNative.cs` | `546f0f6a60af28109fdeff7742b32654ced891cebeb5476941995e3278fe076e` |
| `tests/fixtures/sealed-import/ImportCapture.cs` | `7293ab0881d11b90ca49f7c22b9d34c1d0adb99b65edeb59937f20f283af8dbd` |
| `tests/fixtures/sealed-import/ImportSeal.cs` | `4f2f0050a824ac790b7bc3642744ee3014c327c080c6ed9e48d6f4f87a9d6f69` |
| `tests/fixtures/sealed-import/ImportFixture.cs` | `9f107041f555e4fddd253048b27eca09d9161c22fe5480034fea9ebc8db4bc3b` |
| `tests/main/sealed-import-windows.test.js` | `1fc62b5c8122237f60f0d2d6264f4d4515e5bec7b5ef47d32220e57e5d60f0e7` |
| `tests/main/sealed-import-contract.test.js` | `01738453112bba66299069bc964d1085bb7240a5a3eef921519b7134ca32c634` |
| `tests/fixtures/sealed-import/harness.mjs` | `8398dd1058981f4de911454f2b3a8181b25b83f8fddfcc8d9c5aae19022cae1d` |
| `scripts/qualification/qualify-sealed-import.mjs` | `f197f58c9b43a1191e15357e32c1a2dc596cc68b9c1d85c97a3a6db3000fe5db` |
| `scripts/qualification/sealed-import-build.mjs` | `0630153396880d20a9cf757e00a806d2331c814b97f080b1957b2056f324d931` |
| `scripts/qualification/sealed-import-oracle.mjs` | `b9864db6b187158bcf678ac8d23a12efa199fd0531da3b6d008d89026c689cbd` |
| `scripts/qualification/sealed-import-report.mjs` | `43f7bd57bc70bc4fda3466ea27066e058d9f1044c15302aa5e27a5827281eeb2` |

## Required verification and limits

The default parallel Windows coverage run failed seven tests and one suite setup
(7159 passed, 18 skipped). The six affected existing suites passed 109/109 with
coverage and unchanged timeouts when run sequentially. A serialized full run then
had one gateway test teardown failure: an immediate recursive removal returned
EPERM after its helper/descendant checks, with 7175 passed and 8 conditional skips
already present. The gateway fixture now validates its exact temporary parent
and uses ten bounded removal retries at 50 ms, matching the neighboring fixture.
Both Windows Job suites subsequently passed 19/19. Test assertions and production
cleanup logic are unchanged. Failed receipts are retained; the final complete
Windows coverage command uses `--fileParallelism=false` without changing global
configuration or timeouts.

The ten required local commands are run after source freeze, with individual exit,
duration, source digest and disk/log receipts under `receipts/`. The draft review
packet includes their actual results and the five GitHub required contexts for its
exact HEAD. Linux CI skips the 20 native Windows tests; this local Windows run
executes them. Neither skipped CI cases nor recorded evidence count as new
independent reviewer execution.

No guest/VM qualification, production launch, protected caller/inventory,
credential use, memory-mapped adversary, crash/reboot, power-loss publication,
network denial or export ran. Output protection after closing its handles and
whole-filesystem snapshot semantics remain unqualified. All dummy fixtures are
retained for review with an explicit seven-day policy; no automated cleanup or
future log-growth prevention is claimed.
