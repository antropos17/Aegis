# Packaged agent sensitive-read journey

This check follows an installed Claude Code process reading a newly created
synthetic `.env`, either as its first scoped read or after an owned README read.
Events displays the observed read, its
issuing agent when verified, and a potential sensitive-file risk.

Ordinary Windows x64 packages now expose explicit scoped Start/Stop in Events;
see [ordinary file reads](ordinary-file-reads.md). The historical diagnostic
profile still requires its marker/root flag and retains its minute limit. Both
use the stats bridge; ordinary controls add one owned-renderer IPC operation.

The [idle first-read qualification](../recon/evidence/agent-idle-first-read.json)
passes genuine first reads after 65, 70 and 85 seconds in an ordinary package,
including the original held-handle interval, exact issuer, UI risk and cleanup.
The [earlier ordinary-package record](../recon/evidence/ordinary-agent-sensitive-read.json)
retains its separate attribution FAIL; see [interpretation](ordinary-file-reads.md)
for the proven renewal race and the limits of the historical diagnosis.

## Evidence and interpretation

Paths remain `candidate-object` or `candidate-key`, visibly labelled **Candidate
path**. **Potential sensitive read** comes from enabled path rules. It does not
inspect contents, establish malicious intent, resolve reparse targets or change
risk scores, audit history, baselines or sequence rules.

An agent label requires a held issuing thread covering the event, a fresh full
process creation-time witness, and an exact match in a reliable agent population.
Labels are stamped at intake; later exit or PID reuse cannot relabel history.
An acknowledged preparation of detected AI processes can hold existing workers
before their first scoped read. The first scoped read can also prime workers for
future events, with
at most 128 held thread/process pairs and a 30-second renewable lease. Expired
pins are disposed on the next observation/preparation or at capture disposal. The bounded
Toolhelp snapshot inspects at most 32,768 entries and selects at most 128 TIDs;
every selected thread is independently opened and owner-checked. Unknown paths
do not consume the scoped probe budget. A late lookup never verifies an earlier
read. A standalone short read or a newly created worker can remain unverified.

Preparation uses reliable, exact OS identities after the process scan has
finished stamping. A closed authenticated control exchange selects at most
sixteen AI processes, newest first. Native handles must independently match the
requested PID/full creation time. Preparation stops adding pins at 64, leaving
room for directly observed issuers under the existing 128-pin cap. Requests are
coalesced, have a five-second acknowledgement deadline, and refresh after twenty
seconds. Successful preparation renews the lease of the same live OS objects after
fresh owner/birth checks. Their original held interval stays intact, covering
reads queued before renewal. New workers at the preparation cap cannot prevent
renewal of existing workers later in the bounded inventory. Without renewal,
expiry closes the handles; their replacements cannot verify earlier events.
Reads alone do not renew a lease. Stop takes priority.

Preparation targets and receipts remain in main-only diagnostics. They never
substitute for the fresh birth query used to stamp an actual read. Outages,
ambiguous identities, denied handles, limits and workers created after preparation
can still leave reads unverified.

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

For an ordinary package, add `--ordinary` and use its normal executable. The
runner enters the fixture folder and clicks Start through the actual UI, proves
no automatic capture or diagnostic marker/arguments, then observes at least 65
seconds of continuous capture. The persistent case clicks Stop; the first-read
case verifies normal quit during capture.

Add `--first-read` for the separate first-read scenario. It waits for an actual
preparation receipt matching the installed agent, creates the synthetic `.env`,
and permits exactly one Read tool request with no README warmup. The event-time
issuer proof, visible action/risk, privacy and cleanup requirements still apply.
The earlier persistent-agent PASS does not qualify this new scenario.

For ordinary first reads, `--idle-ms` selects 65,000–120,000 milliseconds (default
65,000). Qualification also requires the actual original held interval to cover
more than thirty seconds before the read. A freshly reopened handle and a
successful UI row alone cannot qualify the idle-renewal regression.

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

## First-read qualification

The [first-read record](../recon/evidence/agent-first-read-preparation.json) binds
two passing live journeys to runtime source `f1a53f4a` and the same complete
285-file diagnostic package manifest. The package uses Electron 44.7.2 and the
installed Claude Code 2.1.292 with its existing account and default model. Both
captures received manual UAC approval on one local Windows x64 machine.

The first journey waited for the real agent's preparation acknowledgement before
creating the synthetic `.env`. It made exactly one Read tool call without a
README warmup. The returned unpredictable value, native PID/full creation-time
witness and renderer identity agreed. The UI showed two verified read
observations for that request, the candidate path and potential sensitive-read
risk. Screenshots in both themes were visually reviewed.

The second journey kept the agent alive across a genuine README Read and a Read
of a newly created synthetic `.env`. The sensitive read had a verified agent row
and potential risk. An additional observation remained visibly unverified; this
result does not establish attribution of every operation. Final native loss and
drop counters were zero in both journeys. Mapping resets/conflicts remain
reported in the record and can invalidate uncertain evidence.

Both journeys excluded file contents from the AEGIS profile and diagnostic reads
from audit rows, exited the agent and app normally, acknowledged native stop,
independently confirmed session absence and left no native helper processes.
The entire package still matched its frozen manifest after the live checks.
The final documentation, test-diagnostic and installation-helper delta leaves the
Electron/ETW package inputs unchanged; required PR checks apply separately.
Ordinary packaged ETW remains disabled.

The record retains the earlier checks without elevation against `41335d2d`,
including real owned handles with synthetic observations, separately from these
live results. It also retains the unsuccessful baseline attempt that expired at
manual UAC before any provider Read. Neither the synthetic checks nor the earlier
persistent-agent package substitute for the new first-read result.

The Windows verification also exposed a separate installation-helper exit race.
A live image query could fail during natural termination before the retained
process handle was signaled, causing a false cleanup-unknown result. The native
observer now allows up to two seconds for that exact handle to signal; a timeout,
failed wait or still-live process remains refused. The existing real native
natural-exit regression failed before this change and passed afterwards. This
follows the [bounded wait contract](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject)
and changes no enrollment or production launch permission. The genuine-agent
captures above qualify the Electron/ETW package, separately from this helper.
