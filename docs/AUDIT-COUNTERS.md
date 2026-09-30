# Historical audit counters

At startup, retention runs before historical counters are seeded. The seeder
captures each retained file's byte length and processes at most 64 KiB per main
thread turn, yielding with `setImmediate` between turns. A partial UTF-8 record
can carry at most 1 MiB; an oversized record is skipped through its newline.

The captured prefix excludes later appends, which the logger counts as live
events. Valid JSON event objects count; `buffer-overflow-drop` markers do not
contribute to totals or date bounds. Malformed or oversized records, changed
file identity, truncated reads and filesystem errors make historical counters
unavailable. Diagnostics do not include journal contents or paths.

`getStats().historyReadState` is independent of storage measurements, the index
and current-session delivery state:

| State | Meaning |
| --- | --- |
| `uninitialized` | No journal has been initialized. |
| `building` | The retained snapshot is still being read; totals are partial. |
| `ready` | All captured records were read and admitted. |
| `unavailable` | Totals are partial because reading/admission failed or was cancelled. |

The Observatory hides historical totals/date bounds while they are incomplete,
shows a fixed loading/failure message and retains independent live queue and loss
observations. Refresh delivery counters to read the completed snapshot. Missing
state remains compatible with an older host; an unknown explicit state does not
admit historical totals.

Shutdown cancels the pending read and closes its descriptor. Reinitialization
cancels the previous seed before resetting counters. Directory enumeration and
metadata checks remain synchronous; this change bounds journal content reads
and parsing, and does not qualify every other startup or forensic export path.
