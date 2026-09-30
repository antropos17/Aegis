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
  limitations must be reported; a bounded-worker pass does not prove a default
  concurrency pass.
- Check the beta version and draft notes in the release PR before authorizing its
  merge. Verify final installer installation/upgrade with a disposable profile,
  then confirm `.exe`, `manifest.json` and `manifest.json.sig` from the same release
  through [offline verification](RELEASE-VERIFICATION.md). Signing uses the existing
  CI secret; local test artifacts are not signed releases.

## Scope and remaining limits

Default monitoring observes and records activity. Selected CLI/MCP actions need
explicit configuration and review. Experimental supervisor, guest, broker and
provider fixtures do not qualify automatic containment of arbitrary agent tools.
The broader enforcement A1–A4 gates remain **UNREVIEWED**, and launch admission
remains unavailable. No VM/provider provisioning is part of beta preparation.

macOS/Linux remain experimental; macOS process-generation identity is unresolved
in [#633](https://github.com/antropos17/Aegis/issues/633). Native Windows test cleanup
and concurrency remain tracked in [#631](https://github.com/antropos17/Aegis/issues/631).
Audit startup counters [#639](https://github.com/antropos17/Aegis/issues/639), Claude
cache pricing [#636](https://github.com/antropos17/Aegis/issues/636) and retained token
state [#637](https://github.com/antropos17/Aegis/issues/637) need their own fixes.
Token totals may lag a backlog or omit oversized records; dollar amounts are local
estimates rather than provider bills. See [token accounting](TOKEN-ACCOUNTING.md).

The 0.17.0-alpha updater does not discover beta tags. Install the first beta manually
after verification; later beta versions accept newer beta or stable releases.
