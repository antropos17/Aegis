# Retained caller token stability

This follow-up is based on integrated HEAD
`dfbd22595473d85bf6b01c356904b3388e437e3d`, branch
`codex/caller-token-stability-20261008`. It strengthens the existing native
caller primitive. It creates no protected launcher, account, installation,
endpoint, VM or production admission route. Qualification flags remain false.

## Reproduced behavior

The Windows x64 fixture retained a disposable child's process and registered
its token, then disabled that child's already-present
`SeChangeNotifyPrivilege`. Independent native queries observed privilege
attributes changing from 3 to 1 and a different token `ModifiedId`, while PID,
process birth time, user SID, authentication LUID and primary `TokenId` remained
unchanged. The original `ReadAndAuthenticate` returned a dispatch context after
this mutation. The unchanged child positive control also succeeded.

The first focused test run produced one expected regression failure, one
passing positive control and 17 deselected tests. The failure was the assertion
that the changed child must not be admitted; fixture compilation and native
mutation observations succeeded.

## Resulting checks

Token observations now retain canonical group SID/attributes, privilege
LUID/attributes and restricting SID/attributes. Every observation samples native
token statistics before and after its queries and refuses a changed token ID,
modification ID, type, authentication identity or inconsistent group/privilege
count. Variable buffers are bounded to 64 KiB and 256 entries; SID pointers,
headers and bodies must remain inside the returned buffer and outside its entry
table. Duplicate identities, invalid SID revision/count and truncated tables
refuse parsing. Canonical sorting preserves attributes.

Rechecking the retained primary token requires the original native `TokenId`
and `ModifiedId` as well as the full observed context. Changing and restoring
privilege attributes therefore does not restore an old registration. Pipe peer
comparison instead requires an impersonation token at the existing supported
level and equivalent observed context. It does not require the impersonation
copy's token or modification IDs to equal the primary token's IDs.

Microsoft documents `ModifiedId` as changing when the token is modified in
[TOKEN_STATISTICS](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_statistics).
The disposable fixture verifies both the
[AdjustTokenPrivileges](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-adjusttokenprivileges)
native result/error and the resulting attributes. Native
[DuplicateTokenEx](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-duplicatetokenex)
controls distinguish a new primary object from an equivalent impersonation
copy, then demonstrate rejection of a changed impersonation copy while the
original primary token stays unchanged.

## Actual pipe projection regression

The initial 39-case strict peer-context result is superseded for peer behavior.
Its immutable `review/FREEZE.json` and receipts remain historical evidence.
Actual maintained runtime admission failed with an unchanged primary token:
independent diagnostic queries observed six primary privileges, five disabled,
and one enabled privilege on the real Node pipe peer. Primary token ID,
modification ID, identity, groups and all other retained context stayed equal.
Diagnostic instrumentation and copied source exist only outside the checkout.

[SECURITY_QUALITY_OF_SERVICE](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-security_quality_of_service)
and [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
describe effective-only impersonation. Peer comparison now allows omission only
of expected disabled privileges. Every supplied privilege must retain its exact
LUID and attributes, and every enabled primary privilege must remain. Full
primary equality, including TokenId and ModifiedId, is unchanged.

An explicit native effective-only pipe test independently counts primary and
peer privileges and requires the observed projection before accepting admission.
Its disposable child disables an already-present privilege before its sole
registration. This initial fixture setup grants no production rebaseline.
Native duplicated-peer controls reject changed enabled attributes and an
additional enabled privilege, then verify the primary remained unchanged.
Restoring a peer copy's attributes restores peer equivalence; restoring a
registered primary's attributes still fails its ModifiedId fence.

The same native reproduction exposed the inbox zero-entry TOKEN_PRIVILEGES
buffer shape: count zero returns 16 bytes. The parser accepts that bounded empty
shape and refuses a truncated zero-entry header. Nonempty tables still require
exactly `4 + 12 * count` bytes. Two buffer models cover this distinction; the
native effective-only test exercises the actual empty observation.

## Composed harness repairs

Six qualification test selectors now choose the first actual Application
returned by Get-Command. Two installed Node executables previously became one
invalid filename, independently reproduced as Win32 error 2.

The maintained cancellation test fixture compiled to 82,944 bytes without
optimization, exceeding its unchanged 81,920-byte cap before native execution.
Its cleanup refusal masked the compile refusal; that failed receipt is retained.
Compiling the exact same twelve sources externally with `/optimize+` produced
78,848 bytes. Adding that flag only to the cancellation TEST compiler preserves
the cap and matches the existing runtime fixture optimization. Actual maintained
cancellation controls then passed. The failed unoptimized artifact establishes
size only and carries no native-control success claim.

## Scoped verification

The maintained caller suite completed 42 tests without skips on Windows x64:
23 process/token/pipe test cases, including three preexisting injected native
API failure paths, and 19 explicitly labeled unmanaged-buffer model cases.
The model cases exercise the actual parser using synthetic allocations; they
do not establish independently issued token observations or protected authority.

The native regression cases cover mutation before admission, refusal of an
already-issued context after mutation, and change-and-restore refusal. Existing
normal admission, retained-server verification, caller exit, disposal, expiry,
framing and reversion controls remain covered by the same scoped suite.

The test command is:

```text
node node_modules/vitest/vitest.mjs run tests/main/session-caller-windows.test.js --project main --maxWorkers 1 --reporter=verbose
```

The fixture compiles the four actual caller sources with inbox x64 .NET Framework
`csc.exe`, `/optimize+` and `/warnaserror+`. Per-process TEMP/TMP and bounded
receipts are on the spacious data drive. Each captured command has an 8 MiB
output cap. The existing node_modules junction is preserved. Formatting, scoped
ESLint and diff whitespace checks complete separately; repository-wide gates
and publication belong to the coordinator.

The full maintained `scripts/qualification/test-cloud-guest.ps1` completed under
Windows PowerShell 5.1 with exit 0. This source composition executed all local
runtime, cancellation, stdio and owner-lifetime controls. Runtime reported 14
native controls for both candidate and same-flags baseline; cancellation
reported 27 controls and both before-ack/no-payload and after-ack/held-descendant
positives. Local controls retain their own native/model scope labels.

Measured compositions were guest DLL 77,312 bytes, optimized runtime fixture
80,384 bytes, cancellation 78,848 bytes and witness DLL 81,920 bytes, within their
existing respective 81,920/81,920/81,920/1,048,576-byte caps. The witness limit
is the unchanged `1MB` test-fixture cap; its measured size is 81,920 bytes.
The runtime default
unoptimized composition was 84,992 bytes and explicitly reported over cap.
Production compiler flags, production sources outside the owned token primitive,
and every cap remain unchanged. Witness completion controls are synthetic.

Final bounded coordinator-runner receipts are
`2026-10-08T13-13-01-842Z-token-stability-composed-final.json` (69.6 seconds,
25,944 log bytes) and
`2026-10-08T13-14-04-580Z-token-stability-caller-final.json` (42/42).
The cancellation receipt is
`2026-10-08T13-12-46-429Z-token-stability-cancellation-optimized.json`.
They reside under `X:/tmp/aegis-github-review-20261006/receipts`; task-specific
source copies, native observations, preserved failures and the new review freeze
reside under `X:/tmp/aegis-caller-token-stability-20261008`.
Only process-local TEMP/TMP and Windows PowerShell module paths were selected;
no global environment or policy was changed. Compile caching was disabled for
the final runner commands.

## Limits

The native mutation is a disposable process privilege change. Live group
attribute mutation and primary-token replacement inside a running process were
not performed. Group bounds, identity duplication, attribute preservation and
ordering controls use synthetic buffers. A duplicated primary token is rejected
by the equality primitive; that test does not provision or replace a process
token. No synchronized mutation during the multi-query observation was injected.

These observations and fences do not freeze a token against changes between
checks or protect a same-user broker from injection. The retained process/token
primitive still needs independently protected launcher registration, principal
policy, endpoint ownership, provenance, inventory and revocation storage. No full
E1/A1 or other production gate is accepted by these results. Independent Astra
review and the coordinator's later endpoint/master integration checks remain
separate evidence. This freeze retains its original integrated ancestry.
