# Retained-instance supervisor caller increment — 2026-10-07

This increment implements reusable native caller observations in
`sidecar/session/CallerNative.cs`, `CallerIdentity.cs`, `CallerRegistration.cs`,
and `CallerAdmission.cs`. The sidecar build includes them. The production
`Program.cs` and `Protocol.cs` remain inactive: both preparation and launch remain
unavailable. This is implementation progress for the caller part of E1–E3, with
no complete enforcement-gate verdict.

## Contract and lifetime

Trusted native code supplies an already-held process handle. Registration
duplicates that handle without inheritance, retains its queried primary token,
PID and birth time, and creates a fresh process-private generation for one
supervisor-selected session. Neither a PID nor token/principal fields from the
wire can create a registration. Each check queries the retained process's live
state, birth and current primary token again. Disposal revokes existing contexts.
The supported broker token is primary, has no restricting SIDs, has no
AppContainer or UIAccess status, and has medium or higher recognized integrity.
The UAC `TokenHasRestrictions` flag is observed separately from restricting SIDs.

The server accepts one complete message-mode frame, at most 4096 payload bytes,
within a two-second read budget. Canonical UTF-8 grammar accepts only
`inspect-owned`, version 1, a request ID, the registered session/generation and
sequence 1. Extra fields, frames, malformed encoding and size mismatches fail.
This operation performs no inventory access or mutation; its name reserves the
future inspection route. This primitive does not provide durable operation
deduplication or replay authority for lifecycle mutations.

Under the registration lock, admission reads the entire message, observes the
actual pipe client PID, impersonates that message's client and queries the thread
token. It requires impersonation token type and SecurityImpersonation level,
plus agreement with the retained broker's SID, authentication LUID, Windows
session, integrity, restriction observations, elevation, UIAccess and mandatory
policy. Reversion occurs in `finally`, before any context is returned. A failed
reversion revokes registration and the production adapter calls
`Environment.FailFast`; it cannot continue a supervisor dispatch.

The resulting context remains process-private. Its current-state check requires
a live registration, connected pipe with the same OS client, no pending extra
bytes and a two-second monotonic lease. Future effect dispatch must share the
registration lock with revocation and recheck the protected resource record; a
successful caller check alone grants no VM, filesystem or credential authority.
The client-side server check compares the OS server PID against a retained live
server registration. It does not establish installation provenance.

## Executed evidence

Base HEAD: `35a2cc8bb464192852e13b35b156c2fe6034e9be`, branch
`codex/enforcement-closure-20261007`. The native x64 fixture compiles the same four
source files with the installed .NET Framework compiler and warnings as errors.
It creates only a fresh first-instance, remote-client-rejecting named pipe and
fixed executable children under process-specific X-drive TEMP. It changes no
accounts, services, ACLs, registry, WFP rules or VM configuration.

The focused command was:

```text
node node_modules/vitest/vitest.mjs run tests/main/session-caller-windows.test.js tests/main/protected-session-windows.test.js tests/main/protected-session-protocol.test.js --maxWorkers=1
```

All 81 tests across three files passed. Eighteen caller tests cover the live
registered child, same-principal sibling, exited and disposed registration,
malformed/oversized/partial/extra frames, invalid UTF-8, wrong generation, forged
PID field, context disposal/disconnect/expiry and correct/mismatched OS server.
The surrounding protected-session tests verify the retained refusal contract.
The bounded runner receipt is
`X:/tmp/aegis-github-review-20261006/receipts/2026-10-07T08-41-05-906Z-session-caller-focused.json`.

The impersonation/query/reversion failure cases inject adapter failures and assert
the relevant seam was reached. Real successful Windows impersonation and
reversion run in the positive and applicable negative cases. The reversion-failure
fixture actually reverts the thread before reporting an injected failure, then
observes the fatal callback and denial; no real failed Windows reversion or
production FailFast crash was induced. These are synthetic failure-path evidence,
separate from the native pipe/process/token observations.

Initial compilation caught unassigned-handle and SafePipeHandle signature errors.
Native execution then exposed one-byte `TokenHasRestrictions` and
`ERROR_BAD_LENGTH` with a four-byte required size for a zero-buffer
`TokenElevation` query. The implementation now handles both bounded native size
query results and checks the complete successful query before reading values.
The initial failed receipts remain in the coordinator's diagnostic directory.

## Unqualified boundaries

The fixture uses the same host principal and logon. It does not protect the
trusted broker from same-user injection or handle duplication, attest a protected
server executable/configuration, or provide protected principal/pipe DACLs.
Different-user/logon/session, low-integrity, anonymous and remote connection
acceptance tests still require the authorized disposable environment. The pipe
creation flags are native fixture observations; they do not provision a product
endpoint. Complete token privilege/group policy beyond the observed fields also
requires the dedicated-principal design.

Protected durable inventory, management-provider VM ownership and job settlement,
actual Hyper-V socket peer admission, image/runtime provenance, guest capability
delivery, strict filesystem/network gates, credentials and export remain outside
this increment. Exact disposable host/image/volume and provisioning authorization
are still required. Native caller admission must not enable launch until those
independent gates are qualified.
