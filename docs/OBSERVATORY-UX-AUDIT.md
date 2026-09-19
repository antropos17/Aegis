# Observatory interaction audit — 19 September 2026

Scope: navigation and command search, guided tasks, monitoring detail focus,
local file review and action checks. The requested changes preserve the existing
Observatory visual system and the underlying monitoring/authorization contracts.

| Finding | Applied change | User impact |
| --- | --- | --- |
| Several unrelated destinations shared a shield or generic file symbol | Fourteen distinct Tabler outline shapes, also used by their task links | A folder review, action route, AI assessment and rule editor are visually distinguishable |
| Start here and Settings repeated in toolbar and sidebar | Keep the permanent sidebar entries; remove duplicate toolbar buttons | Less repeated navigation above the working area |
| Workspace names and task aliases generated duplicate command results | Match all aliases, deduplicate by workspace plus section | One result per destination, with specific section shortcuts preserved |
| Navigation could leave focus in the now-hidden originating page | Focus the destination main region with preventScroll after navigation settles | Keyboard users continue in the destination without resetting saved scroll |
| Closing Commands after selection restored the old trigger | Restore it only on dismissal and only while visible | Choosing a result does not move focus back to an unrelated control |
| Completed checks sat below the full configuration form | Put captured results first in DOM; add deliberate controls between result and setup | Evidence and decisions have priority while drafts remain available |
| Raw action metadata preceded catalog decisions | Place selected action decisions above technical details | The user sees the decisions before implementation details |
| Deferred evidence focus could target an inactive retained workspace | Check hidden/inert ancestors before focusing, preserve scroll | A late update does not pull keyboard focus into an inactive page |

The icons are selectively vendored from [Tabler Icons](https://github.com/tabler/tabler-icons)
at a pinned revision. The [provenance record](../frontend/observatory/vendor/tabler-icons.provenance.json)
contains source URLs and hashes; the [MIT notice](../frontend/observatory/vendor/tabler-icons.LICENSE)
is included in desktop packaging. Runtime rendering accepts local geometry only.

Validation covers command selection/dismissal, saved scroll and keyboard focus,
result/setup order, retained drafts, four themes, English/Portuguese and enlarged
scale. Real-preload Electron fixtures cover local review/export/acceptance and
nonexecuting action checks using disposable files. Visual results are captured
locally; synthetic preview data is excluded from the production bundle. This is
an interaction audit, not a claim of assistive-technology certification or a
complete audit of every operating-system dialog.
