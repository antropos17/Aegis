# Windows beta readiness

Current release: **0.18.1-beta**, Windows desktop monitoring and explicitly reviewed
selected-action workflows. Check the [release page](https://github.com/antropos17/Aegis/releases)
for published versions and complete artifacts. Changing the prerelease channel
does not itself publish an installer or establish release readiness.

## Published Windows beta

[0.18.1-beta](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.18.1-beta)
was published on 5 October 2026 from `2720637` through
[PR #738](https://github.com/antropos17/Aegis/pull/738). Its candidate `68a9073`
passed all ten mandatory Windows checks: 423 files, 7,634 passing tests and eight
skipped, with four workers and compile cache disabled. The exact release PR and
merged master passed all five required CI contexts. The Windows release workflow
built and published the installer and both Ed25519 manifest files successfully.

The downloaded installer passed offline signature/hash verification. Its manifest
names the tag and exact release commit; 223 runtime files match canonical Git after
line-ending normalization, and 116 renderer files match the local production build.
The five expected Windows helpers are present. Its extracted application reports
Electron 43.7.7, Node 24.21.0, Chromium 150.0.7871.250 and Undici 7.29.1; it passed
native checks of 11 workspaces, real sensors, six exports, configuration import,
settings across restart and Electron hardening without renderer errors.

The app and installer remain Authenticode **NotSigned**. The installer was extracted
and its application tested; installation/upgrade/uninstall remain unqualified.
Local and published installer bytes are not claimed reproducible.

### First beta — 1 October 2026

[0.18.0-beta](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.18.0-beta)
was published on 1 October 2026. Final beta revision `3c52c75`
passed all ten mandatory Windows checks: 421 files, 7,623 passing tests and eight
skipped, with compile cache disabled. The exact release PR passed five required
CI contexts. The downloaded installer passed the repository's offline Ed25519
manifest/hash verification; its extracted application passed a native smoke with
an isolated profile, settings across restart and six exports.

These checks do not establish installer installation/upgrade/uninstall behavior.
Those scenarios remain unqualified; macOS/Linux and broader enforcement retain
the limits below. Manifest signing is separate from Windows Authenticode.

## Post-publication follow-up — 5 October 2026

Before the 0.18.1-beta publication above, the download remained **0.18.0-beta**.
The following follow-up source checks preceded the final PR #738 qualification.

[PR #739](https://github.com/antropos17/Aegis/pull/739) replaces Chokidar 3 with
4.0.3 and pins devalue 5.9.3 and http-cache-semantics 4.3.0. Fresh production and
full npm audits report zero findings. A real Windows Electron watch-worker fixture
observes add/change/unlink in a literal brace-containing directory and ignores the
lockfile. One unchanged component test timed out during concurrent browser QA;
its isolated rerun and a complete coverage run with two workers passed without
changing the test or its deadline.

Exited token-cost history now compacts into one explicit archive after 256 recent
exited records; all live records, run totals and uncertainty flags remain. Provider
and identity outages, suspend gaps and exit grace prevent premature compaction.
Regression tests exercise 10,000 identities and 600 live records, and a disposable
Electron profile renders the archive. The separate Claude transcript dedup state
and long-duration native qualification remain open in
[#637](https://github.com/antropos17/Aegis/issues/637).

Outstanding release work remains installer install/upgrade/uninstall in a disposable
Windows environment, Authenticode, native macOS/Linux and enforcement qualification.
The README loaded all 20 images at a 390×844 dark browser viewport without page
overflow; the active GitHub social GIF still needs an authenticated Settings change
([#626](https://github.com/antropos17/Aegis/issues/626)).

Current source pins Electron 43.7.7. Its Windows binary reports Node 24.21.0,
Chromium 150.0.7871.250 and Undici 7.29.1. The first beta's Electron 43.5.0
embeds 7.29.0, which falls within the affected ranges of the upstream
[BalancedPool](https://github.com/nodejs/undici/security/advisories/GHSA-w293-vg96-wgc3)
and [WebSocket](https://github.com/nodejs/undici/security/advisories/GHSA-rfgv-xxqx-mfg5)
advisories. The main/shared source search described below found no corresponding
call sites; that limited result does not establish runtime-wide clearance.

## 0.18.1-beta release qualification

[PR #738](https://github.com/antropos17/Aegis/pull/738) advances source version
markers to **0.18.1-beta** and includes the dependency, token-history and embedded
runtime updates above. The dependency graph is unchanged from the combined source
at `30ef329`; only its root package version changes in the release lockfile.

[PR #741](https://github.com/antropos17/Aegis/pull/741) passed all ten mandatory
Windows checks: 423 files, 7,634 passing tests and eight skipped, with the default
four workers and compile cache disabled. Its exact revision and merged master
passed all five required CI contexts. Its locally built NSIS payload matched the
unpacked application byte for byte and passed a native isolated-profile smoke,
including settings across restart and six exports. That package retained the
0.18.0-beta source version; it is evidence for the runtime change, rather than
qualification of the final 0.18.1-beta package.

Final candidate packaging, exact-head CI and downloaded release manifest
verification passed as recorded above. Installation/upgrade/uninstall and
Authenticode remain unqualified; publication does not complete those gates.

## Windows source-check prerequisites

On a fresh Windows checkout, run `npm ci`, then warm Electron with
`node -e "require('electron')"` and run `npm run build:sidecar` before the
ten verification commands. The lazy Electron download must finish before tests
using fake timers start; selected-action CLI tests also use the default built
Windows helper. Preparation does not change their assertions or deadlines.

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
| Asynchronous bounded Windows Job fixture deletion | [PR #729](https://github.com/antropos17/Aegis/pull/729), ten consecutive native runs of ten tests; combined Windows coverage at `f9b61ec`: 418 files / 7,615 passing tests, eight skipped, compile cache disabled; five successful required CI contexts |
| Bounded Claude session registries, including stat/read races | [PR #732](https://github.com/antropos17/Aegis/pull/732), five public-adapter regressions, 45 focused passing tests, all ten mandatory Windows checks and five successful required CI contexts |
| Claude process fairness under continuously growing transcripts | [PR #733](https://github.com/antropos17/Aegis/pull/733), real continuously appended transcripts failed before rotation and now observe later-process usage once; 59 focused passing tests and five successful required CI contexts |

Combined development revision `2c5d78c` passed all ten mandatory Windows checks:
420 files, 7,621 passing tests and eight skipped, with compile cache disabled.
The unchanged production interface passed a fresh browser matrix at `5b0f022`
(264 workspace and 160 footer checks), followed by native Electron checks of
eight footer scenarios, twelve Statistics labels and four text-growth cases.

These checks belong to their recorded PR revisions. Final combined-source checks
and a final-version installer smoke are separate release gates. A source or
unpacked-application smoke does not prove installation or upgrade behavior.

## Runtime dependency update

[PR #736](https://github.com/antropos17/Aegis/pull/736) updates the locked
Electron runtime from 43.4.1 to 43.5.0 and compatible brace-expansion, minimatch,
undici and fast-uri entries. A fresh installation and full npm audit report zero
registry findings; no direct major upgrade or new override is included.

That first beta's Electron 43.5.0 embeds Node 24.19.0. Its embedded Undici version
is 7.29.0, which npm audit does not inventory. Main/shared code uses Node
HTTP(S) and electron.net.fetch; a static search found no Node fetch, WebSocket,
Undici interceptors or BalancedPool call sites. This limited reachability check
does not establish runtime-wide security clearance.

## Release gates

- Verify the shipped runtime, including embedded libraries outside the npm graph.
  The first beta's Electron 43.5.0 update addresses the reported Electron 43.4.1
  [advisory](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq).
  A clean production-only npm audit does not qualify the desktop runtime.
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
  The one-time `release-as: 0.18.0-beta` override selected the first beta and is
  removed after publication. Later release PRs use the beta prerelease channel
  without that fixed override, as described in the [manifest configuration](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md).

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
Claude transcript dedup state [#637](https://github.com/antropos17/Aegis/issues/637)
remains unbounded for the application lifetime. Exited cost history compacts as
described above. A future dedup retention policy must preserve cumulative spend,
process-instance attribution and deduplication when a Claude session resumes.
Token totals may lag a backlog or omit oversized records; dollar amounts are local
estimates rather than provider bills. See [token accounting](TOKEN-ACCOUNTING.md).

The 0.17.0-alpha updater does not discover beta tags. Install the first beta manually
after verification; later beta versions accept newer beta or stable releases.
