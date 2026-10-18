# Packaged agent sensitive-read journey

This check follows an installed Claude Code process reading an owned README and
then a newly created synthetic `.env`. Events displays the observed read, its
issuing agent when verified, and a potential sensitive-file risk.

The ETW deployment gate remains in force: capture requires a marked diagnostic
Windows package and an explicit fixture root. Ordinary packages keep capture
disabled. The view uses the existing stats bridge and adds no IPC channel.

## Evidence and interpretation

Paths remain `candidate-object` or `candidate-key`, visibly labelled **Candidate
path**. **Potential sensitive read** comes from enabled path rules. It does not
inspect contents, establish malicious intent, resolve reparse targets or change
risk scores, audit history, baselines or sequence rules.

An agent label requires a held issuing thread covering the event, a fresh full
process creation-time witness, and an exact match in a reliable agent population.
Labels are stamped at intake; later exit or PID reuse cannot relabel history.
The first scoped read can prime existing worker threads for future events, with
at most 128 held thread/process pairs and a 30-second lifetime. The bounded
Toolhelp snapshot inspects at most 32,768 entries and selects at most 128 TIDs;
every selected thread is independently opened and owner-checked. Unknown paths
do not consume the scoped probe budget. A late lookup never verifies an earlier
read. A standalone short read or a newly created worker can remain unverified.

The view retains at most 64 grouped rows within a conservative 128 KiB budget,
counts omitted observations, shows measured loss or Unknown, and distinguishes
live capture from retained rows. A new capture clears the previous view.

## Run

Use a clean checkout matching the package inputs, installed Claude Code with its
existing account/default model, and a fresh ordinary output directory outside the
source tree. This performs real provider inference and requires one manual UAC
decision. Account settings and Claude session persistence stay unchanged.

```text
node frontend/observatory/tests/agent-read-electron.mjs --executable <absolute-diagnostic-AEGIS.exe> --agent-executable <absolute-installed-claude.exe> --output <new-absolute-output>
```

The runner creates disposable fixtures and an AEGIS profile under its output.
Only Read is available to the CLI. The `.env` is created after capture starts;
its unpredictable synthetic value is absent from the prompt. The actual Read
request, returned value, native issuer witness and visible action/risk must agree.
A renamed fixture process cannot substitute for the installed agent.

The CLI remains alive across both turns. Completion requires normal CLI/app exit,
native stop acknowledgement, an independent session-absence query and no remaining
helpers. Unknown cleanup or failed privacy inspection forces FAIL. Modeled oracle
tests do not establish live acceptance.

Private output includes a bounded receipt, shutdown metadata and screenshots.
Provider text remains in bounded process memory. Profile inspection checks both
markers and excludes diagnostic fixture reads from audit rows. Preserve receipts
and failed attempts; review closed disposable diagnostics after seven days. This
is a manual retention policy, without automatic cleanup.

## Changes and verification

Parallel handles can share a FileKey. Previously, closing one handle erased the
independently named FileObject used by another read; unrelated zero-key cleanup
also erased scoped names. Native regressions reproduce both failures. Close now
retires its object and uncertain key aliases while preserving other independently
named objects. Unidentified closes, conflicts, losses, ordering failures and caps
still invalidate uncertain evidence. Candidate paths are not promoted.

The mapping uses the opened-object lifetime described by
[Microsoft FileIo_ReadWrite](https://learn.microsoft.com/en-us/windows/win32/etw/fileio-readwrite)
and [FileIo_SimpleOp](https://learn.microsoft.com/en-us/windows/win32/etw/fileio-simpleop).
Worker inventory follows Microsoft's
[thread-list traversal](https://learn.microsoft.com/en-us/windows/win32/toolhelp/traversing-the-thread-list);
the snapshot alone is never identity proof.

The [source/package-bound live record](../recon/evidence/agent-sensitive-read.json)
retains the result and earlier unsuccessful attempts separately from modeled
tests. Production admission remains open.
