# Protected launch through AEGIS

The selected direction is launch through AEGIS. Already-running agents remain
under observation and manual process controls. The desktop's saved permissions,
watchlist and reviewed alerts remain advisory; sensitive-file observations arrive
after access. The selected-file delete operation must not be reused as quarantine.

## Available CLI slice

The [AppContainer launch route](../ACTION-APPCONTAINER.md) requires one fresh
terminal confirmation for an exact action, creates an empty new workspace,
verifies a zero-capability AppContainer token before resuming the process, and
assigns the process atomically to a Windows Job. Policy deny, failed setup and
unavailable isolation never authorize an ordinary fallback. Retained workspace,
Job cleanup and temporary-profile cleanup have separate receipt fields.

The existing Windows Job confirmation route still supplies process lifetime
cleanup with the caller's ordinary access rights. Neither route changes the
protection of ordinary agent launches or desktop saved permissions.

The isolated route is bounded to one short offline action. Publicly granted
Windows resources remain accessible according to AppContainer ACL checks. Runtime
compatibility is specific to the selected executable; installed software ACLs
are never broadened automatically. Microsoft's boundaries are documented in
[AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)
and [implementation guidance](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer).

## Remaining broker and desktop work

An exact-file broker should show the selected path, operation and grant lifetime
before supplying a bounded copied snapshot or opened validated handle. Changed
inputs, replay, expired approval and broker disconnection must fail closed. File
contents stay out of reports, telemetry and approval messages. This broker is not
implemented by the initial empty-workspace route.

Network remains restricted until a narrow provider broker is designed and tested.
Ordinary account credentials must not be inherited to make an agent work. A
long-running agent owner will need explicit lifetime, restart and resource bounds,
plus runtime compatibility evidence, before replacing the short-action deadline.

The quarantine-like desktop action for this scope is **stop and retain the
isolated workspace**: cancel pending approval, revoke future broker requests,
terminate Job members and retain files for inspection. The UI must distinguish
stop requested, stop confirmed and cleanup unknown. Resuming requires a new
explicit launch and grants. Retention does not reverse past effects or relocate
original user files. Automatic deletion of retained workspaces is not enabled.

## Evidence required before desktop exposure

- Private-file read/write and network restrictions need native fixture tests
  with unrestricted positive controls; ordinary descendants must inherit them.
- One-file grants must prove identity, scope, expiry, replay and disconnection
  behavior before they can be offered in the desktop.
- Crash/restart must recover only owned temporary profiles, bound pending state,
  and preserve uncertainty when cleanup or workspace retention is unconfirmed.
- Incompatible executables and missing native APIs must refuse execution without
  an ordinary fallback or a protected badge.

Native tests for the initial route live in
`tests/main/action-appcontainer-windows.test.js`; transport and report tests
exercise its separate receipt protocol. The presence of these checks does not
qualify untested installed agents or the remaining broker and desktop features.
