# Deviation profile lookups — 2026-09-14

`checkDeviations` previously rebuilt the historical endpoint, directory and
sensitive-category sets for every live instance, including instances sharing a
profile. It now builds these warning-comparison sets once per eligible profile
object within the synchronous check. The map is discarded on return; in-place
edits and replaced profiles are read on the next call.

Warnings, suppression and scores still belong to each instance. Score dimensions
are still computed independently when that instance emits new warnings. The
last-five-session endpoint window and warning order are unchanged.

## Reproduction

```powershell
node scripts/bench-deviation-profiles.cjs --baseline=7212ef8ea4af8cb6440b0dd60d137d16f0413106 --report=X:/tmp/deviation-profiles.json
```

Use a trusted baseline SHA and a new output filename. The script loads both
actual detector revisions with separate cloned in-memory fixtures and the same
current scoring module. Each profile contains five sessions with 256 endpoints
each, 128 typical directories and one sensitive category. It checks complete
warning equality, unchanged input and equal dimension-scoring call counts.

Each arm has an initial check, 20 warm-up checks, then 20 interleaved samples of
five checks each. The median averages the two middle samples. `new-warnings`
clears suppression before each check; its timing includes that reset. No OS
sensor, DNS, file persistence, Electron launch or UAC prompt is used.

Windows x64, Node v24.11.1; median milliseconds per check:

| Instances | Profiles | Mode | Previous | Current |
| --- | --- | --- | --- | --- |
| 1 | 1 | Normal | 0.03953 | 0.04314 |
| 1 | 1 | Already warned | 0.03643 | 0.03667 |
| 1 | 1 | New warnings | 0.09089 | 0.09605 |
| 8 | 1 | Normal | 0.32526 | 0.12752 |
| 8 | 1 | Already warned | 0.34408 | 0.14585 |
| 8 | 1 | New warnings | 0.64435 | 0.42237 |
| 8 | 8 | Normal | 0.30850 | 0.31545 |
| 8 | 8 | Already warned | 0.29406 | 0.29885 |
| 8 | 8 | New warnings | 0.55354 | 0.59850 |

The improvement is in shared-profile checks. Single-instance and distinct-profile
cases showed no improvement and were slightly slower in this run. These timings
describe controlled JavaScript work, not total application CPU. Source/scorer
hashes and all results are in the [JSON report](deviation-profile-work-2026-09-14.json).

The regression test first failed with eight reads of a historical collection
instead of one. Three new tests verify bounded reads per pass, freshness after
in-place changes and replacement, separate profiles and instance scores, warning
suppression/retirement, and the last-five-session boundary. The focused anomaly
and scoring suites passed all 62 tests after the change.
