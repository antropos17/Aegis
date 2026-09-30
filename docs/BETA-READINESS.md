# First beta readiness — 1 October 2026

Target: **0.18.0-beta**, Windows desktop monitoring and explicitly reviewed
selected-action workflows. The published version remains 0.17.0-alpha until a
new release is authorized, built and uploaded. Changing the prerelease channel
does not itself publish an installer or establish release readiness.

## Changes with completed development verification

| Change | Evidence |
| --- | --- |
| Signed beta discovery and channel progression | [PR #717](https://github.com/antropos17/Aegis/pull/717), authenticated manifest/provider regression tests and five successful required CI contexts |
| Bounded audit-chain tail recovery; failed recovery preserves pending events | [PR #718](https://github.com/antropos17/Aegis/pull/718), malformed/unreadable/large-tail regressions and five successful required CI contexts |
| Production renderer rebuilt before every package | [PR #719](https://github.com/antropos17/Aegis/pull/719), failed-build/order regressions and five successful required CI contexts |
| Bounded Claude transcript reads and oversized-record recovery | [PR #720](https://github.com/antropos17/Aegis/pull/720), byte-budget/UTF-8/truncation regressions and five successful required CI contexts |
| Compatible minor/patch dependency maintenance | [PR #698](https://github.com/antropos17/Aegis/pull/698), fresh dependency installation and required CI |
| Owned Windows fixture closure, private helper builds and bounded default worker load | [PR #722](https://github.com/antropos17/Aegis/pull/722), default Windows coverage: 413 files / 7,598 passing tests, eight skipped; repeated native fixtures: 16 passing tests, no EPERM |
| Human observation labels and footer growth after language/badge changes | [PR #724](https://github.com/antropos17/Aegis/pull/724), seven regressions, two repeated native passes and final native pass; eight footer scenarios, twelve Statistics labels, 160 browser footer states and 264 workspace checks; 7,605 passing Windows tests |
| Bounded, cancellable audit-history counters with explicit loading/failure state | [PR #725](https://github.com/antropos17/Aegis/pull/725), captured-prefix/live-append, retention, malformed/oversized record and shutdown regressions; 7,603 passing Windows tests and five successful required CI contexts |
| MCP fixture readiness follows completed endpoint publication | [PR #727](https://github.com/antropos17/Aegis/pull/727), four deterministic delayed-publication regressions and five consecutive native runs of 34 tests; sanitized failure diagnostics |
| Lazy local-review tests separate module compilation from loading behavior | [PR #728](https://github.com/antropos17/Aegis/pull/728), controlled pending import, unchanged visible-state assertions and deadlines, two fresh focused runs and five successful required CI contexts |
| Claude cache-read and duration-specific write prices | [PR #726](https://github.com/antropos17/Aegis/pull/726), real main/subagent transcript accounting, cross-file deduplication and unknown-duration/model regressions; 65 focused passing tests and five successful required CI contexts |
| Asynchronous bounded Windows Job fixture deletion | [PR #729](https://github.com/antropos17/Aegis/pull/729), ten consecutive native runs of ten tests; Windows coverage at `8069317`: 417 files / 7,611 passing tests, eight skipped, compile cache disabled |

These checks belong to their recorded PR revisions. Final combined-source checks
and a final-version installer smoke are separate release gates. A source or
unpacked-application smoke does not prove installation or upgrade behavior.

## Release gates

- Resolve the shipped Electron runtime advisory and review all dependency changes.
  Electron 43.4.1 is a development dependency but ships in the desktop runtime;
  a clean `npm audit --omit=dev` cannot clear that risk. See the
  [Electron advisory](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq).
- Verify the final combined source with the ten commands in [AGENTS.md](../AGENTS.md),
  a fresh `npm ci`, Windows native fixtures, the production renderer and packaged
  smoke. Retain failures and the actual tested revision. Windows concurrency
  policy defaults to four Vitest workers; record the configured worker count and
  any different stress-run limits with the results.
- Check the beta version and draft notes in the release PR before authorizing its
  merge. Verify final installer installation/upgrade with a disposable profile,
  then confirm `.exe`, `manifest.json` and `manifest.json.sig` from the same release
  through [offline verification](RELEASE-VERIFICATION.md). Signing uses the existing
  CI secret; local test artifacts are not signed releases.
- The existing alpha version is preserved by Release Please's default versioning.
  A one-time `release-as: 0.18.0-beta` selects the first beta explicitly. After its
  authorized release PR is merged, remove this override before preparing another
  release, as described in the [manifest configuration](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md).

## Scope and remaining limits

Default monitoring observes and records activity. Selected CLI/MCP actions need
explicit configuration and review. Experimental supervisor, guest, broker and
provider fixtures do not qualify automatic containment of arbitrary agent tools.
The broader enforcement A1–A4 gates remain **UNREVIEWED**, and launch admission
remains unavailable. No VM/provider provisioning is part of beta preparation.

macOS/Linux remain experimental; macOS process-generation identity is unresolved
in [#633](https://github.com/antropos17/Aegis/issues/633). Windows fixture cleanup
received a follow-up in [PR #729](https://github.com/antropos17/Aegis/pull/729) after
a later combined-source run reproduced EPERM. Earlier successful checks remain
evidence for their recorded revisions, rather than a guarantee for later runs.
Retained token state [#637](https://github.com/antropos17/Aegis/issues/637) remains
unbounded for the application lifetime. Compaction must preserve cumulative spend,
process-instance attribution and deduplication when a Claude session resumes.
Token totals may lag a backlog or omit oversized records; dollar amounts are local
estimates rather than provider bills. See [token accounting](TOKEN-ACCOUNTING.md).

The 0.17.0-alpha updater does not discover beta tags. Install the first beta manually
after verification; later beta versions accept newer beta or stable releases.
