# Retained caller context and supervisor thread token — 2026-10-09

Status: a native same-principal regression and correction for the inactive caller
primitive. Full E1.2, E1.5 and A1 remain incomplete. Preparation and launch remain
unavailable; this increment provisions no protected broker or supervisor.

## Trigger and correction

`CallerAdmission.ReadAndAuthenticate` requires a clean supervisor thread before
authentication and after reverting its own pipe-client impersonation. An issued
context can be checked later, after that thread acquires another impersonation
token. Previously `Context.CheckCurrent` rechecked the retained peer, token,
pipe and lease while accepting that changed calling-thread state.

The [supervisor contract](supervisor-caller-inventory-design-20260930.md) requires
reversion before acting as supervisor and refusal under uncertain impersonation.
The current-context fence now requires absence of a thread token under the
registration lock, before its native observations and immediately before return.
`CallerNative.HasThreadToken` accepts only `ERROR_NO_TOKEN` as safe absence;
query failures deny the check. The fence does not silently revert an unexpected
token or establish a resource mutation capability.

## Native regression and controls

The new `tests/fixtures/session-caller-context/CallerContextFixture.cs` creates a
fresh first-instance, remote-rejecting message pipe and registers an actual held
child process. The child builds its frame from the registration's issued session
and generation. Initial admission traverses the real pipe read, peer/process/token
observations and reversion. A successful current-context check increments a
disposable process-local effect counter.

The negative case duplicates the fixture process's token into an impersonation
token and applies it to the calling thread with `SetThreadToken`. A separate
`OpenThreadToken` / `GetTokenInformation` observation confirms token type and
SecurityImpersonation level before checking the issued context. Its effect
counter must stay zero. `RevertToSelf` runs in `finally`; failure terminates the
fixture. The clean thread succeeds again after independently observed reversion,
and the retained child is observed exited. No privileged operation is dispatched.

Against base `e1e90794bdae51654c97591efca87a9abc046778`, the positive case passed
and the negative failed: `threadTokenObserved=true`, `rejected=false`,
`impersonatedEffects=1`. Against corrected source, the focused Windows x64 suite
passed 57 tests without skips. The context suite supplies two controls, the
existing caller suite supplies 42, and the endpoint suite supplies 13. The
existing suite includes explicitly
modeled buffer and injected API cases; the new token transition is native.

```text
node node_modules/vitest/vitest.mjs run tests/main/session-caller-context-windows.test.js tests/main/session-caller-windows.test.js tests/main/session-caller-endpoint-windows.test.js --maxWorkers=1 --reporter=verbose
```

Each context fixture compiles the four actual caller sources with the inbox x64
.NET Framework compiler, `/optimize+` and `/warnaserror+`. The baseline and
corrected receipts are retained under
`X:/tmp/aegis-github-review-20261006/receipts` as
`2026-10-09T03-47-02-631Z-caller-context-baseline.json` and
`2026-10-09T03-47-29-325Z-caller-context-corrected.json`. Their bounded logs contain
2344 and 11785 bytes respectively, without truncation. TEMP/TMP are process-local
X-drive paths. Source hashes, direct native output and independent review are
retained separately from these test summaries.

## Acceptance limits

The token has the same principal as the disposable fixture. This measures a
calling-thread state transition and denial at a retained-context fence. It does
not qualify separate protected principals, broker injection/handle protection,
inventory authority, cross-session impersonation, VM transport, crash/reboot
recovery or full E1/A1. The fence cannot freeze a token against later changes;
future dispatch still needs the shared authorization lock and protected resource
checks. Corrected local controls do not relabel earlier hosted source receipts.
