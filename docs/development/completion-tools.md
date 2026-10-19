# Completion tools

Use this guide to choose a bounded preparation or development tool. Start with
its contract and run commands from the repository root with the Node version in
`.nvmrc`. Each result retains the scope of its tool; fixture success alone does
not establish workstream acceptance.

| Need | Entry point | Contract |
| --- | --- | --- |
| Prepare WinGet candidate YAML from a local signed release | `node scripts/prepare-winget.cjs --help` | [WinGet preparation](../../packaging/winget/README.md) |
| Check an explicitly pinned local EXE's embedded Authenticode observation on Windows | `node scripts/verify-authenticode.cjs --help` | [Authenticode prerequisite](../RELEASE-VERIFICATION.md#windows-authenticode-prerequisite) |
| Bind one local Windows candidate's signed manifest identity and independent pins to fresh Authenticode evidence | `node scripts/verify-windows-candidate.cjs --help` | [Combined candidate gate](../RELEASE-VERIFICATION.md#combined-windows-candidate-verification) |
| Evaluate ordinary-task false-alarm evidence offline | `node bench/task-false-alarms.cjs --help` | [Task evidence and scoring](../bench/TASK-FALSE-ALARMS.md) |
| Compare paired task completion evidence offline | `node bench/paired-task-latency.cjs --help` | [Task outcomes and latency](../bench/PAIRED-TASK-LATENCY.md) |
| Check dormant Windows Coverage through the real preload | Dedicated Electron fixture below | [Coverage preload fixture](../bench/COVERAGE-PRELOAD.md) |
| Develop native Windows hook IO with inert owned targets | Owner-prepared development fixture | [Private Windows hook IO](../CLAUDE-HOOK-WINDOWS-IO.md) |
| Develop Windows context reads from an explicitly selected stable/exported file | Private owner API and local .NET fixture | [Stable-file reader contract](../SESSION-CONTEXT-WINDOWS-IO.md) |

## WinGet candidate preparation

Read `node scripts/prepare-winget.cjs --help`, then supply the explicit release
and metadata inputs described in the [preparation contract](../../packaging/winget/README.md).
The local directory must contain the signed manifest, detached signature and
selected installer. The tool authenticates that manifest with the checkout's
release public key and checks the selected installer's signed size and SHA-256.
Choose a new `--out` directory under an existing, caller-owned parent.

The three YAML files are candidates. Published URL fetching, Authenticode checks,
actual WinGet validation, install/upgrade/uninstall qualification and submission
remain separate release steps in [Release verification](../RELEASE-VERIFICATION.md#offline-winget-candidate-preparation).
Publisher, package metadata and payload architecture require independent evidence.

## Ordinary-task false-alarm evidence

Read `node bench/task-false-alarms.cjs --help` and prepare the closed JSON input
from its contract. For example, after selecting owned input and output parents:

```sh
node bench/task-false-alarms.cjs --input owned-evidence/task-evidence.json --output owned-reports/new-task-result.json
```

Choose your own paths; the input must exist and the output must be a new file.
The evaluator collects nothing and starts no tasks. It retains the same eligible
started cohort, including failed, refused and timed-out tasks. Incomplete eligible
observation yields `null` incidence. Freeze the rubric before starts and seal the
actual roster after starts; independently retained cohort, observation and
adjudication evidence remains required. Synthetic inputs verify arithmetic and
refusal behavior only; the [measurement method](../bench/METHOD.md) governs W8.

## Optional Windows Coverage fixture

Read the [fixture contract](../bench/COVERAGE-PRELOAD.md) before running this
Windows x64 check. It requires installed dependencies and an already available
Electron binary. Select a new report directory whose ordinary parent exists:

```sh
node frontend/observatory/tests/coverage-preload-electron.mjs --build --output owned-reports/new-coverage-run
```

This builds the production renderer and opens a dedicated disposable fixture
with the real preload and actual dormant ETW health leaf. Surrounding stats are
fixture values. It retains a receipt, bounded log and screenshots; its contract
defines cleanup and `--reuse-build` requirements. Normal startup, live native
capture and full W9 acceptance remain outside the measured boundary.

## Native hook IO development

Follow [Private Windows hook IO](../CLAUDE-HOOK-WINDOWS-IO.md) for the installed
.NET SDK build, generated asset pins, private owned storage and explicitly new
inert targets. Its driver requires an owner-prepared asset manifest. This route
has no profile discovery, application IPC/UI registration or installer activation;
the inert fixture result does not establish provider enforcement or W6 acceptance.
