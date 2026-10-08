# Retained caller token stability

This scoped change is based on HEAD
`d495f116ca042e67d69ee7368fef2316c3a4a147`, branch
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

## Scoped verification

The maintained caller suite completed 39 tests without skips on Windows x64:
22 process/token/pipe test cases, including three preexisting injected native
API failure paths, and 17 explicitly labeled unmanaged-buffer model cases.
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
review and the coordinator's integration checks remain separate evidence.
