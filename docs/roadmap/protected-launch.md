# Protected launch through AEGIS

The chosen next direction is an explicit protected launch through AEGIS. Existing
agents already running elsewhere remain under observation and manual process
controls. This document distinguishes the working launch gate from planned OS
isolation; no roadmap item changes protection by itself.

## Available launch gate

`--action-exec-windows-job-confirm` reviews the exact executable, working
directory, arguments and environment before one launch. Policy deny cannot be
overridden; an affirmative terminal challenge creates one short-lived attempt.
Refusal, timeout, terminal loss or a changed selected configuration prevents
launch. Approved execution uses the existing Windows Job helper, which assigns
the suspended child to its Job before allowing execution and confirms member
cleanup on completion or cancellation. Output reports retain the distinction
between confirmed cleanup and an unknown outcome.

This gate leaves the allowed program's account privileges unchanged. It has no
file/network access restrictions, no rollback and no control over processes
created through external brokers. The desktop's saved allow/monitor/block values
and watchlist remain advisory. Sensitive-file observations arrive after access;
marking them reviewed never isolates anything. The current selected-file delete
operation deletes a file and must not be reused as quarantine.

## Proposed OS boundary

Prototype an AEGIS-owned AppContainer launch broker with no network capabilities
and a separate disposable working directory. AppContainer supplies an OS access
check boundary; Windows Job supplies process lifetime cleanup. Microsoft documents
the boundaries in [AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)
and [implementing an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer).
Compatibility with installed AI agents is unverified. Broadly readable Windows
resources remain accessible; the requirement concerns private resources outside
the explicitly granted workspace, not a claim that every host file is hidden.

The first production slice should run one explicitly selected action with a
minimal runtime in a fresh workspace. It must create the restricted token and
Job before execution, refuse unavailable isolation without a normal-launch
fallback, and retain observable evidence for setup, execution and cleanup.
Do not recursively change ACLs on user projects, installed runtimes or home
directories to make a failing agent work.

File approval should let the broker supply an exact operator-selected file to
that workspace after showing the path, requested operation and request lifetime.
Use an opened/validated handle or a bounded copied snapshot so a changed path
cannot silently grant another object. Private contents stay out of telemetry,
reports and approval messages. Network stays disabled until a separate narrowly
scoped broker design is implemented; ordinary user credentials are not inherited.

The quarantine-like action for this scope is **stop and retain the isolated
workspace**: revoke future broker requests, cancel pending approval, terminate
Job members, and retain their disposable files for inspection. The UI must
distinguish stop requested, stop confirmed and cleanup unknown. Restoring work
requires a new explicit launch and new grants. Original user files remain in
place, and retaining a workspace does not claim to reverse prior effects.

## Acceptance evidence before exposure in the desktop

- An isolated fixture cannot open a seeded private file or make a network
  connection; positive controls demonstrate that the fixture otherwise runs.
- An explicit one-file grant permits only its selected content; changed inputs,
  replay, expired approval and broker disconnection fail closed.
- Child processes inherit isolation; cancellation kills ordinary Job members
  and reports missing cleanup evidence as unknown.
- Unavailable native APIs, setup failure and incompatible runtimes never result
  in an ordinary launch or a protected badge.
- Crash/restart and partial setup retain a recoverable workspace record with
  bounded diagnostics, while temporary identities and owned resources are
  cleaned without touching unrelated processes, ACLs or profiles.

These are release criteria for the proposed isolation feature. They are not
claims that the current launch gate or a disposable native probe satisfies the
complete design.

## Native feasibility observation, 27 September 2026

A disposable Windows probe created an AppContainer profile and passed its SID
with zero capabilities to `CreateProcessW`, then assigned the suspended process
to a Job before resuming it. A system `cmd.exe` wrote a marker into a fixture
directory explicitly granted to that SID. Reading a separate private fixture
returned `Access is denied` and did not copy its content. Profiles were deleted
after the runs and the observed fixture processes exited.

An AppContainer `curl.exe` did not connect to a local test listener, while a
direct control did. Curl reported a timeout, so this observation does not prove
an OS network denial; public-network restriction was not tested. The probe did
not independently inspect `TokenIsAppContainer`, qualify Node/Claude/Codex,
exercise a file broker, or verify crash cleanup. Its temporary source and receipt
are retained locally for follow-up and are outside the shipped application.
