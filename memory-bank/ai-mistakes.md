# AI Mistakes Log — AEGIS

Repeated mistakes by Claude Code. READ BEFORE EVERY CHANGE.

## CSS / Styles
1. Adds text-transform: uppercase to h2 globally — breaks settings/modal headers
2. Removes existing hover states and transitions when "improving" CSS
3. Uses overflow: hidden instead of overflow: auto — content gets clipped
4. Hardcodes rgba/hex colors instead of using tokens.css custom properties (var())

## Security
5. Writes innerHTML without escaping — XSS risk (threat-analysis.js precedent)
6. Does not run Svelte MCP autofixer before finishing .svelte files
7. Does not escape user input in generated HTML

## Logic
8. Classifies .json/.yaml as "sensitive config" — too aggressive
9. Does not deduplicate events — one file triggers 100+ alerts
10. sensitive * 10 = linear growth without cap — risk instantly hits 100

## General Behavior
11. Adds features that were not requested (hamburger menus, animations, responsive)
12. Forgets to update exports.js when adding a new IPC channel
13. Writes vanilla JS patterns — renderer uses Svelte 5 with $state/$derived/$effect runes, NOT vanilla JS
14. Creates dead code — functions that are never called
15. Double-encodes UTF-8 — instead of – (en dash)

37. **Two Claude Code sessions in ONE checkout share ONE working tree, so the second session's
    uncommitted files sit on the first session's branch, and either commit sweeps the other's
    work in.** First hit 2026-08-24, between block 1 prompt 2 (#309) and block 2 prompt 1 (#310)
    of `docs/roadmap/sequence-rules.md`. A branch is a pointer, not a workspace: `git checkout`
    in one session re-points the tree under the other, and an untracked file is on no branch at
    all — it belongs to whichever branch is checked out when someone runs `git add`. Nothing
    goes red. Each session sees its own diff plus a stranger's, reads the stranger's as noise,
    and the next `git add .` lands both under one message (cf. #22 — untracked files have no
    safety net; #32c — audit the file list of anything that stages what you did not write).
    **Confirmed good approach:** every parallel session works in its own git worktree under
    `X:\tmp` (`git worktree add X:\tmp\<name> -b <branch> master`), with a junction to the main
    checkout's `node_modules` — or its own `npm ci` when that directory is not intact — merges
    through its own PR, and removes the worktree after (`git worktree remove`). Git refuses to
    check one branch out in two worktrees, so the isolation is enforced by the tool rather than
    by discipline.

## Documentation
16. Leaves outdated agent counts in README badges, CLAUDE.md and architecture docs
17. Does not sync agent counts between README badges, CLAUDE.md and agent-database.json
24. Repeats a hand-maintained counter instead of deriving it. No CI check computes these figures
    from the tree — the `audit-check` skill derives the agent count and nothing else, and only when
    someone runs it — so a count is true only until the next merge and NOTHING goes red when it
    stops being true. `src/main/` was documented as 46 CJS modules (37 top-level); adding
    `sensor-health.js` in `273dedc` (2026-08-09) made it 47/38, and the dead figure sat in EIGHT
    files — CLAUDE.md, the aegis-context and electron-main SKILL.md under BOTH `.claude/skills/`
    and `.agents/skills/`, memory-bank/architecture.md, STATE-RECON.md, and CORRECTNESS-AUDIT.md,
    which had audited the number and recorded "match". Derive before quoting
    (`git ls-files 'src/main/*.js'`), and assume the figure you were sent to fix has siblings.

39. **Two authority documents state the same rule with opposite force — and one of them
    disagrees with itself — so every PR that meets the rule has to pick a side on its own.**
    `CLAUDE.md` rule 3 says 300 lines/file is a TARGET for new files, not an invariant, names
    the files already over it as derived by `npm run counts:check`, and says not to split for
    the number. `AGENTS.md` "Code conventions" carries that same sentence, and its "What NOT to
    do" list, lower in the same file, says a new file must not blow past 300 lines — extract
    instead. #308 (`src/main/sequence-rule-loader.js`) and #310 (`src/main/sequence-engine.js`)
    each landed a new module over the line and each had to decide which sentence governed. Both
    chose rule 3 and bumped `size.over300` at its declaration sites — but the choice was made
    twice, in two PR bodies, instead of once in the documents, and a reader who opens the
    "What NOT to do" list first is told to cut a state machine into pieces to satisfy a sentence
    the same file has already retired (cf. #20 — a reader acts on what a document says; #24 — a
    fact with two homes drifts, and this one has three).
    **Decision, recorded so it is not re-made:** CLAUDE.md rule 3 wins. 300 is a target for new
    files and the reason to extract when adding to a file already over it, never a gate;
    `size.over300` stays a DERIVED counter that `counts:check` computes from the tree and is not
    to become a limit; the AGENTS.md "What NOT to do" bullet is to be aligned to rule 3 in the
    next docs pass, which this entry does not perform. Until then, where the sentences disagree,
    rule 3 is the one to cite.

## PowerShell
18. Uses && in PowerShell commands instead of ; or powershell.exe -NoProfile -Command wrapper

## CI
23. Regenerates package-lock.json with the LOCAL npm and breaks every CI job. The local
    npm is 11.x; CI runs Node 22, and this repo pins no npm version — never assume the
    resolver that reads your lockfile is the one that wrote it. npm 11 dedupes entries npm 10 still
    requires — `svelte-check/node_modules/picomatch` was hoisted away, and every job died
    at `npm ci` with "Missing: picomatch@4.0.5 from lock file" (commit `a6dccc7`, fixing
    `a91f2e1`). The lockfile is CI's input, not yours: rebuild it from master, and verify
    with `npm ci` exiting 0 on Node 22 before pushing.
    A `npm install` that succeeds locally proves nothing about the resolver that will read
    the file.

35. **Confirmed good approach — a release-please PR's CI is PARKED, not slow, and one manual
    approve per release is a budgeted step rather than a defect.** Measured 2026-08-23 shipping
    `aegis-v0.13.0-alpha` (PR #265, merge `c6830ff`). A workflow run on a PR that GITHUB_TOKEN
    opened is CREATED and then held: `status: completed`, `conclusion: action_required`, and
    **zero jobs**. `gh pr view <n> --json statusCheckRollup` therefore answers `[]` — the five
    required contexts are ABSENT, not pending, which is not a state that resolves by waiting,
    and on the PR page it is indistinguishable from a queue that has not got to you yet. On the
    `release-please--branches--master--components--aegis` branch,
    `gh run list --branch <branch> --limit 100` answered 80 `action_required` against 5
    `success`: parked is the DEFAULT for that branch, not an incident to re-diagnose each
    release.
    **No Actions setting changes it.** `repos/{owner}/{repo}/actions/permissions` is
    `enabled: true, allowed_actions: all`, and `.../actions/permissions/workflow` publishes only
    `default_workflow_permissions` and `can_approve_pull_request_reviews` — neither governs this.
    The approval is a platform rule about token-authored events; stop hunting for the toggle and
    budget the click instead.
    **How to apply — find the run by HEAD SHA, never by list position or attempt number.**
    `gh pr view <n> --json headRefOid`, match it in
    `gh run list --branch <branch> --json databaseId,headSha`, then
    `gh api repos/{owner}/{repo}/actions/runs/{id}/approve -X POST`. The attempt counter is not
    a signal: the two approved runs on this branch came back `run_attempt: 2` (`13a27eb`,
    0.13.0-alpha) and `run_attempt: 1` (`df863e4`, 0.12.0-alpha).
    **Every `update-branch` resets the whole thing.** master is `strict: true`, so any merge
    landing while the release PR is open turns it BEHIND, and the updated head is a NEW SHA whose
    run is parked from scratch — the earlier approval does not carry over, and the green already
    read describes a SHA that is no longer the head. Re-verify status after each update (cf.
    #34(b), the identical second round on fork PRs, and #34(c) — that branch update is a merge
    commit, so audit its file list; #21 — a command that ran is not a command that inspected your
    change).

## Migrations
19. Migrates ONE identity store to a new key and stops — when an identity key changes (bare pid → instanceId), sweep ALL sibling consumers in the same effort: session-tracker, file-watcher knownHandles AND token-tracker each held their own pid-keyed map (PR #180–182). A half-migrated identity is worse than none: the migrated store and the stale one silently disagree about who a process is.

20. Documents a mechanism that was never built — worse than a stale number, because a
    reader can act on it. Real cases found 2026-07-30 (PR #185): README promised
    "extend or override via `rules/custom/`" (no such directory; `loadRules(dir)` REPLACES
    the directory and a duplicate rule ID is skipped, so overriding is impossible);
    CONTRIBUTING's agent template documented a required field `processPatterns` that appears
    nowhere in the codebase (it is `names`), so anyone following the guide adds a
    silently-ignored key; ARCHITECTURE listed 11 IPC channels that do not exist plus a whole
    "Send" section for an API preload never had. Before writing that a feature exists, open
    the code that implements it. If only a plausible-sounding shape exists, say what is
    actually there instead.
21. Reports a gate as green without checking it covers anything. `tsc -p` exits 0 on a
    project whose file set is EMPTY, and says nothing about it (PR #184: `typecheck:renderer`
    checked 0 of 30 renderer files). `npm test` passes when a suite is skipped. A passing
    command proves the command ran, not that it inspected your change. Confirm coverage
    (`--listFiles`, file counts) or inject a deliberate failure and watch the gate go red —
    then revert it.
22. Destroys a file with a side edit nobody asked for. The requested steps were done correctly;
    the damage came from an adjacent "while I'm here" byte-level rewrite of `memory-bank/progress.md`
    — at that point still untracked (it only entered git in `e7ba29d`), so there was no `git checkout`
    to undo it and only an external editor snapshot brought the log back. Untracked files have no
    safety net: git cannot restore what it never saw. Touch ONLY the bytes the prompt named. If a
    file looks wrong in a way the task did not mention, report it and leave it alone.
    Corollary: a local `format:check` red on a Windows checkout (150 files, CRLF-only diffs, CI green) is a config gap, not a formatting one — `"endOfLine": "auto"` in .prettierrc clears it without touching a single source byte; never "fix" it with a repo-wide `prettier --write`.

## Verification
25. **Confirmed good approach — a measurement gate that refuses or blocks beats one that annotates.**
    Block 1's Generation v2 sidecar is trustworthy because every correctness check was built to STOP
    the pipeline on disagreement, never to explain it away. (a) **Self-oracle at startup:** the
    sidecar refuses to start unless its OWN record is in the snapshot with `CreateTime` EXACTLY equal
    to `GetProcessTimes` on its own handle — a one-tick disagreement exits 2 and AEGIS falls back, so
    a subtly-wrong reader can never be believed as if it were right. (b) **A parity check that gates
    the block, not a footnote:** ms-parity required 542 of 542 comparable pids to agree EXACTLY
    between sidecar and CIM, because a one-millisecond disagreement would split a live session's
    identity and token ledger on a mid-session fallback — so it shipped as a blocking `--parity` gate,
    never a "rounds to the same millisecond" annotation. (c) **A gate reads its evidence off the thing
    it is proving, not shared state** (the contamination clause `verify:gate` kills): the cwd witness
    gate reads provenance off the agent record, not out of the shared cache, or a mutant that leaks
    cached state passes green. Lesson: when a plausible-but-wrong value could satisfy a check, make
    the disagreement halt the work; a check that annotates around a doubt is decoration (cf. #21).

26. **The `scan-loop.test.js:1275` recycled-pid flake is still live, and its green proves nothing about
    identity (verified 2026-08-13 on `b2d55b7`, 40 runs).** 19/20 pass idle, 18/20 under a concurrent
    full-suite load, always `expected 5 to be 1` on the `memMb` assertion — lower than the reported
    ~3-in-7, not gone. It was recorded in no known-flakes note anywhere in the repo before this line.
    The defect is cross-test leakage, not the assertion: `-t`-filtered the test passes 20/20 and ten
    whole-suite runs pass 10/10, because resource-monitor's module-level exec is shared and a prior
    test's fire-and-forget `getResourcesForPids` can still reach `makeVaryingExec`'s sample counter.
    Per #21 it also cannot credit #206/#208 either way: `process-utils.js` is never loaded by this
    file, `platform/process-snapshot.js` loads transitively but is never called, and both birth times
    are literals in the test's own factory fed to the pure `identify()`.
    **Fixed 2026-08-13 in #219** — root cause was this file stubbing resource-monitor's exec in ONE
    describe block while every scanning test reached it, so the rest spawned real `powershell.exe`
    that settled on real time and resumed inside a later test, against that test's exec. 40/40 green
    after, 0 real spawns, exactly 2 sampling calls where 13 had landed. The vacuity above is unchanged:
    the fix removed the noise, not the missing coverage.

27. **Writes a comment that claims MORE than the mechanism guarantees, and the overclaim
    outlives every rewrite that touches the same lines.** Three live cases, all found
    2026-08-14 in one sweep, all of the same shape: a true narrow fact stated as a total one.
    (a) `process-identity.js` said a pid+birth-timestamp merge "is the only failure mode".
    It is the only way that KEY FORMAT loses a distinction; the opposite failure — one live
    instance read with two different birth milliseconds across ticks, splitting its session
    and token ledger across two keys — comes from source disagreement and is exactly what the
    542/542 and 419/419 sidecar-vs-CIM parity gates exist to stop (#25). "Only" was doing work
    the file could not back. (b) The same header said "a collision needs the OS to free and
    reissue the same pid inside 1 ms". The stored millisecond is a FLOOR, so the real condition
    is that both creation times land in the same millisecond bucket — 0.86 ms apart inside one
    bucket collides, 0.1 ms apart across the boundary does not, which is precisely the pair
    `tests/fixtures/bench/derived/D1-pid-reuse-same-ms/` models. (c) `bench/lib/report.js`'s
    fingerprint recorded itself as "the bytes this process then executed": `join.js` is already
    in the module cache when the hash is taken and `report.js` reads its own file while
    executing, so it is a DISK read at load — under a concurrent edit it describes on-disk
    bytes, not loader-cached ones. Same for a diagnostic: replay said a renderer match with
    differing bytes meant "the deterministic contract failed", when the fingerprint pins two
    files and explicitly does not cover the Node version, the platform, or anything else.
    Two lessons. **Write the guarantee, not the impression** — say which surface the claim
    covers and name what is left open, the way `RENDERER_COVERS` already did next door.
    **An overclaim is not fixed by a rewrite that walks past it:** PR #206 rewrote the very
    bullet holding (b) and left the sentence intact, and (a) sat two lines above untouched, so
    both survived every later reader who had seen the file "recently corrected". Grep the
    claim, not the file (cf. #24 — assume siblings; #20 — do not document what is not there).

28. **`git grep --untracked` NARROWS the sweep while reading like a widening, and this repo is
    shaped to be caught by it.** The flag switches git grep off the index and onto a working-tree
    walk with the standard exclusions applied, so a TRACKED file living under an IGNORED path
    drops out of a search that plain `git grep` would have answered. `.gitignore:22` ignores
    `.claude/*` and un-ignores only `skills/`, `agents/`, `commands/`, `hooks/` and
    `settings.json` — `.claude/rules/` is on none of those lines, yet
    `.claude/rules/code-quality.md` is tracked and is a live rules file. Measured on git 2.52.0:
    `git grep -n --untracked -F -e 'GPG signing on all commits'` returns NOTHING and exits 1,
    while both `git grep -n -F -e ...` and `git ls-files -z | xargs -0 grep -n -F -e ...` return
    `.claude/rules/code-quality.md:7` and exit 0. Adding `--no-exclude-standard` brings the hit
    back, which is the proof that the exclusion moved and the file did not. An empty result is
    the failure mode here: nothing goes red, and "I grepped the whole tree" is what gets written
    down (cf. #21 — a command that ran is not a command that inspected your change).
    **Verify against the index instead:** `git ls-files -z | xargs -0 grep -n <pattern>`
    enumerates exactly what git is tracking, ignore rules and all, and `-z`/`-0` survive the
    paths with spaces. Use it whenever the question is "does this string still exist anywhere in
    the repo" — the sweep for siblings that #24 and #27 both demand is worth nothing if the walk
    silently skips a directory.

29. **A boolean derived from an enum has DESTROYED states, and a derivation that reads the
    boolean cannot get them back. Read the enum.** `getProcessCapabilities()` publishes both
    `populationState` (STARTING | HEALTHY | DEGRADED | FAILED) and
    `populationReliable: _processHealth.state === HEALTHY` — true for exactly one member, so
    `false` means "one of the other three" and never says which. The app-health state machine was
    designed, written up and REVIEWED with the rule `populationReliable === false → app FAILED`.
    It reads as obviously right and is obviously wrong the moment the collapse is named: a
    never-scanned process leaf sits at STARTING with the flag already false, so the rule declares
    a NORMAL startup — every launch, in the window between `loadDeferredModules` and the first
    3 s tick — a total observation failure. `population-scope-gate.test.js` had pinned the
    premise in prose the whole time ("a never-scanned leaf is STARTING, not reliable, and has no
    asOf"); nothing connected it to the new rule because the rule never mentioned STARTING.
    The boolean was not wrong and did not need changing: it is the capability GATE agent-scoped
    consumers read before observing, and it is correct for that. It is simply not expressive
    enough to classify a lifecycle, and a lifecycle is what a state machine is.
    **Three things follow.** (a) When a type offers an enum and a boolean over the same fact, a
    DERIVATION takes the enum and a GATE may take the boolean — and say in the code which one it
    is and why, or the next reader re-picks by convenience. (b) The discriminating test is the
    one that separates the collapsed members: three cases (STARTING → starting, DEGRADED →
    degraded, FAILED → failed) all carrying `false`, plus a mutant that restores
    `if (!flag) return FAILED` and must go red on the first. A single "the flag is false → FAILED"
    test passes under both versions and proves nothing. (c) A full design review is not a filter
    for this class: the error lives in what a name suggests rather than in what any line says, so
    it survives every reader who does not open the definition. Grep the definition, not the name
    (cf. #27 — write the guarantee, not the impression).

30. **Narrows a pattern without an adversarial list of what the OLD one matched and the new
    one does not — and then pins the narrowing with a must-match list that protects only what
    someone happened to write down.** PR #249 rewrote SC003/SC005/SC006 to bound each keyword
    with `[._-]` separator classes and to scope loose compounds to an extension allowlist. It
    shipped with a table of what must stop firing and what must keep firing, an "accepted
    residuals" section, and per-rule tests — and every one of those lists was built from the
    false positives that had prompted the work, never from the far larger set of names the old
    pattern used to match. `[\\/][^\\/]*password[^\\/]*$` matched any basename containing the
    word at any extension; the replacement matched a bounded word at 17 listed extensions.
    Everything in that difference left the ruleset silently, and nothing anywhere went red.
    A reviewer found it later: `passwords.kdbx`, `password.db`, `passwords.xlsx`,
    `1password_backup.csv` and `1password-export.1pux` — five ordinary password stores, all
    critical-risk hits before #249, all unclassified after it.
    **Two independent causes, and the report named only one.** (a) SEPARATOR BOUNDARY —
    `(?:[^\\/]*[._-])?` can only end on `.`, `_` or `-`, so a digit adjacent to the keyword has
    nothing to match and the whole prefix group is forced empty: reproduced in node against
    master, `password_backup.csv` matched and `1password_backup.csv` did not. (b) EXTENSION
    ALLOWLIST — the list held no password-manager format, so `.kdbx`, `.db`, `.xlsx` and
    `.1pux` dropped out with their separators perfectly intact. Three of the five reported
    misses never involved a digit at all, so the one-line diagnosis in the report covered two
    of five and a fix that only widened the separator class would have left the other three
    broken while reading as done.
    **Three things follow.** (a) Before narrowing, build the adversarial list FIRST — sample
    what the old pattern matched and the new one does not, and decide each entry in or out on
    purpose. A residual you enumerated is a decision; a residual you never enumerated is a
    regression waiting for someone else to report it. (b) A must-match list is not a sample,
    it is the entire protected set: write every case into the test, spell out both path
    separators, and read "not on the list" as "not protected" (cf. #21 — a passing gate proves
    the command ran, not that it inspected your change). (c) Reproduce the report before
    trusting its diagnosis. Running the five names through the real loader is what separated
    the two causes; the summary sentence would have sent the fix at one of them (cf. #27 —
    write the guarantee, not the impression).

36. **A test case that eats 2.9 s of a 5000 ms budget is not passing, it is scheduled —
    record it as known noise BEFORE the next session rediscovers it.**
    `tests/shared/bench-scenarios/actor-secret-hold.test.js` has now gone red twice across
    sessions on cold full `npm run test:coverage` runs, both times as `Test timed out in
    5000ms`, and both times it was green on the immediate rerun and green in isolation. It
    was recorded in no known-flakes note anywhere in the repo, so each session met it as a
    fresh red and spent the time suspecting its own diff (cf. #26 — the identical omission
    for `scan-loop.test.js:1275`).
    **The margin is measured, not guessed** (2026-08-23, master `e1f1615`, two isolated runs
    of the file, 8/8 green both times): `hold-secret-file > spawns the staged binary against
    the seeded file, and bounds its own lifetime` took 3183 ms and 2892 ms, while the other
    seven cases together took ~320 ms. `vitest.config.js` sets no `testTimeout`, so the
    budget is Vitest’s 5000 ms default and that one case is the only one anywhere near it.
    What it spends is not work its assertions do: the two sibling cases that stage the same
    binary and never spawn it took 152 ms each, and `hold-secret-file` awaits the child’s
    `spawn` event only — never the 1500 ms hold — so nearly all of the ~2.9 s sits between
    `spawn()` and that event, the OS launching a ~90 MB image `copy-binary` wrote moments
    earlier. That is machine cost, and a cold whole-suite run (three projects across parallel
    workers plus v8 coverage) is exactly what eats the ~1.8 s that is left.
    **How to apply — rerun first, investigate second.** ONE failure of this test on a full
    run is known noise: rerun before suspecting your diff, and do not read it as evidence
    about the change under review. Investigate only if it fails TWICE IN A ROW on full runs,
    or if it fails in isolation —
    `npx vitest run tests/shared/bench-scenarios/actor-secret-hold.test.js --project main`
    is the isolated command, and either of those is a different signal from this one. This
    note RECORDS the flake and nothing more: the test, its timeouts and the vitest config
    are untouched, and no green here is a claim about them (cf. #21).
    **Corrected 2026-08-24 in #317 — it was not machine cost, it was one measurable
    thing and it is gone.** The gap between `spawn()` and the child's `'spawn'` event is
    Windows scanning a freshly written PE in full the first time it is EXECUTED, and
    `copy-binary` had just written an ~86 MB copy of `node.exe` for `hold-secret-file` to
    launch. Measured isolated on the affected machine: a fresh 86 MB copy took 3812 ms to
    reach `'spawn'`, the SECOND launch of that same copy 8 ms, a second fresh 86 MB copy
    3754 ms, and a fresh copy of a 45–455 KB system binary 86–123 ms — the cost is per new
    file and roughly proportional to its size, never per launch. The case's own phases,
    five cold runs and five under a parallel `typecheck:svelte`: `copy-binary` 156–193 ms,
    `seed-secret-file` 3–8 ms, `hold-secret-file` 3472–3962 ms, the cleanup kill 1–2 ms,
    the `afterEach` removal 15–25 ms with its retry loop never once spinning — 3664–4159 ms
    of a 5000 ms budget on an IDLE machine. The paragraph above reads the remainder as "a
    cold whole-suite run is exactly what eats the ~1.8 s that is left"; there was no ~1.8 s
    left to eat, and 2.9–3.2 s was the low end of that range, not its centre.
    **The fix is the test's staging source, and no production code.** Nothing the file
    asserts needs an interpreter — every assertion is about the argv the actor built and
    the catalogue row it wrote, and no case runs the child, because `execute()` kills what
    it spawned in its `finally` before a hold script could open anything — so `STAGE_STEP`
    copies a small system executable (`ping.exe` on win32, the same source
    `bench/scenarios/S1-agent-lifecycle` already stages; `/bin/true` elsewhere) and falls
    back to `process.execPath` where no candidate exists. `bench/lib/actor.js`,
    `vitest.config.js` and every timeout are untouched: raising the budget was the
    fallback and it was not needed. After: the case is 87–120 ms (10/10 green — 5 cold,
    5 loaded), the whole file 142–216 ms of test time against ~4.3 s before, and 365 ms
    inside a full `test:coverage` run. **"Rerun first" is retired for this case** — a red
    here is a signal again, and per #21 that is a claim about this case only.

38. **A test that builds its input by regex-replacing `\n` over a fixture read from disk is red
    on a Windows checkout and green on Linux CI, and two sessions in a row called it "known local
    noise" — it was a test that did not test on this platform.**
    `tests/main/sequence-rule-loader.test.js` › `two adjacent NETWORK steps carry no adjacency
    warning` reads `tests/fixtures/sequences/warning/adjacent-file-steps.yaml` and rewrites it
    with `/ {4}event\.action:\n(?: {6}- \S+\n)+ {4}file\.path\|re\|i: .*\n/`. `.gitattributes`
    says `* text=auto`, so this checkout holds the fixture as CRLF (`git ls-files --eol` →
    `i/lf w/crlf`), `- \S+\n` cannot match `\r\n`, the `file.*` selection survives the rewrite
    to `category: network`, and the loader answers two `unsatisfiable-field` errors where the
    case asserts zero. On an LF checkout — every CI runner — the regex matches and the case is
    green, which is how #308 merged it. #309's PR body then reported the red as pre-existing and
    CI-green, #310's did the same with the mechanism spelled out, and neither touched it — so on
    this machine that case has failed at `loadErrors` on every run and has never reached the
    warning assertion it exists for (cf. #21 — a passing gate proves the command ran, not that
    it inspected your change; #26 and #36 — a red recorded nowhere is rediscovered every
    session).
    **Two rules follow.** (a) A test that reads a fixture and matches line ends normalises CRLF
    FIRST — `.replace(/\r\n/g, '\n')` on the text it read — so the regex is about the format and
    not about the checkout; a `-text` attribute on the fixture, the way `tests/fixtures/bench/**`
    and `keys/**` already carry one, is the other honest form. (b) One red on the local run is
    not noise until the cause is NAMED: "green in CI" and "not my diff" are both true of a test
    that is broken on this platform, and only a red whose mechanism is written down may be filed
    as noise. This entry records the defect; the test and the fixture are untouched here.

## Caching
31. **Treats a cache KEY as proof that cached data is still fresh.** A key is a LOCATOR —
    it says which entry to look at, never that the entry still describes the thing it
    was written about. Whenever correctness depends on the cached value still belonging
    to the CURRENT generation of an external resource (an OS process under a recycled
    pid, a file at a re-created inode, a remote row after a rewrite), the key alone
    cannot decide it and neither can adding more fields to the key: two generations that
    agree on every keyed field produce the same key by construction.
    - Freshness evidence must come from a FRESH authoritative observation made on this
      pass. A cached generation token certifying itself is circular — it always matches.
    - Shared cached state must never be read as its own provenance. A downstream consumer
      should take the generation off the record the current observation produced, not
      re-read the shared cache: a cache entry is shared by every record that ever used
      that key, so a record that never went through the observation would silently borrow
      someone else's proof.
    - Tests must cover same-key/different-generation (the entry is stale but reachable)
      AND cross-record contamination (record B inherits record A's generation). A test
      that only exercises cache-hit and cache-miss proves neither.
    - Measure the steady-state provider-call and latency cost before calling the fix
      "free" or "no extra I/O". Moving an observation from conditional to unconditional
      adds a call on exactly the passes that used to be cheapest.
    Precedent PR #206: `parentChainCache` was keyed `pid|name` and served the DEAD
    process's `startTime` — the field `instanceId` is built from — to a same-name pid
    reuse, so two instances shared one session, one dedup set and one token ledger.
    The fix was one fresh `getParentProcessMap` observation per non-empty enrichment
    pass, with the cached chain and cwd honoured only while the freshly observed birth
    time still matched. **The proof token was SUPERSEDED in #208:** that birth-time
    comparison became a generation WITNESS compared on value AND source, today
    `createTime100ns` from the snapshot sidecar (`SequenceNumber` is deliberately not
    wired). Residual bound, documented not hidden, and narrower than #206 left it: a pid
    reuse landing in the same stored epoch-millisecond still collides on the identity KEY
    (process-identity.js TIME RESOLUTION), so session, dedup set and token ledger merge —
    the chain and cwd caches no longer do, because the 100 ns witness separates the two
    instances. They collide too only under the CIM emergency fallback, where
    `_witnessOf` derives the witness from that same stored millisecond.

## Tooling
32. **Two overlapping tool scopes that disagree silently corrupt whichever files only one of
    them sees; align the scopes, and after any merge commit diff the file list against what
    was intended.** The pre-commit hook (`.husky/pre-commit` runs `npx lint-staged`) and the
    `lint` job's `format:check` step drive the same prettier with the same `.prettierrc`, so
    they read as one mechanism. They were not one: `format:check` globs `src/**`, `bench/**`
    and root-level `*.{js,ts,json}` and CHECKS, while lint-staged's `*.{js,ts,json}` was
    matched with micromatch's `matchBase` — lint-staged turns it on for every pattern that
    contains no slash (node_modules/lint-staged/README.md lines 334-340) — so the hook WROTE
    every staged `.js`/`.ts`/`.json` at any depth. Measured against master `24912ed`: the hook
    could rewrite 315 files where `format:check` gated 187. Of the 128 it saw alone, 117 were
    under `tests/`, six were `scripts/*.js`, plus `rules/_schema.json`, `.codex/hooks.json`,
    `.codex/hooks/branch-guard.js`, and two `.json` files under `src/` —
    `src/shared/agent-database.json` and `src/renderer/lib/i18n/translations/en.json` — which
    the `src/**/*.{js,ts,svelte,css,html}` extension list does not cover.
    **The write side being wider than the check side IS the failure mode.** A gate narrower
    than the writer cannot object to the writer's output: the reformat is valid Prettier, so
    nothing goes red, and the only file at risk is the one no gate ever reads. It landed
    twice. First on `tests/fixtures/bench` — byte-exact replay recordings that the hook
    reflowed out of matching their rebuild, so `tests/main/bench/replay.test.js` compared a
    rebuild against a file the formatter had edited. That was repaired with a
    `.prettierignore` line, which fixes one directory and leaves the scope mismatch standing.
    Second during the PR #207 merge commit, on two master-side files under
    `tests/shared/bench-trace/` — files that merge was not changing at all, staged only
    because a merge stages what it resolves. The workaround was restoring the bytes and
    committing with `--no-verify`.
    **Three things follow.** (a) When two tools share a job, make their scopes the SAME SET,
    not merely similar ones: the fix was `./*.{js,ts,json}` (the documented root-only,
    matchBase-free form, README line 339) plus the `bench/**/*.{js,json}` the hook had never
    had — proven by running `git ls-files` through micromatch with lint-staged's own options
    and diffing that against the set prettier resolves from the `format:check` globs. 187
    files each, empty diff in both directions. (b) A per-file ignore entry is a symptom fix.
    It buys the current directory and hides the next occurrence, which arrives somewhere else
    (cf. #24 — derive the fact, do not restate it in one more place). (c) A merge commit
    stages files you did not write. After every merge, diff the changed-file list against
    what the merge was supposed to touch: this corruption lands on files absent from your own
    diff, exactly where nobody is looking (cf. #22 — a side edit nobody asked for destroys a
    file).

33. **`PUT /repos/{owner}/{repo}/topics` REPLACES the whole list; there is no add.** The
    endpoint takes a `names` array and stores exactly that array, so a call assembled as
    "the topics I want to add" deletes every topic missing from the payload. It answers 200
    with the truncated list, which reads like success — nothing goes red, and the only
    evidence of the loss is the repository page (cf. #21 — a command that ran is not a
    command that inspected your change). On 2026-08-22 an additive-looking PUT dropped
    `monitoring` and `security` from this repository; both were restored the same day, but
    no gate produced that catch.
    **How to apply:** GET the current list, union it with the additions on the client side,
    PUT the union, then GET again and diff the result against the set you intended — the
    read-back is the only proof the write did what you meant. The same shape recurs wherever
    the request body IS the whole collection rather than a delta (issue labels, a
    branch-protection object, a workflow `permissions` block), so check what the verb
    replaces before assuming a call appends. The live topic list belongs in the API, not
    restated here (cf. #24).

## Review
34. **Confirmed good approach — an external fork PR is four separate gates, and two of them
    fire AFTER the review already looks finished.** Established on the first two fork PRs
    this repository received, #274 and #273, both merged 2026-08-23.
    (a) **CI approval is per HEAD SHA, not per PR.** A fork PR’s workflow run sits at
    `conclusion: action_required` with `status: completed` until
    `gh api repos/{owner}/{repo}/actions/runs/{id}/approve -X POST`; the approved run comes
    back as `run_attempt: 2`. A run parked this way is indistinguishable from a slow one on
    the PR page, so find it by head SHA rather than waiting.
    **Correction 2026-08-25 — (a) generalised from two first-time contributors. Approval is
    gated on CONTRIBUTOR CLASS, not on the PR being a fork: a fork PR whose author already
    has a merged PR here starts CI unapproved, and the setting that says so is readable.**
    Found merging #304/#305/#306 (all `MsfPablo`), where every head ran on its own — three
    PRs in a row, and again after `update-branch`.
    **The setting is the answer, and it is neither of the two #35 ruled out.**
    `gh api repos/antropos17/Aegis/actions/permissions/fork-pr-contributor-approval`
    → `{"approval_policy":"first_time_contributors"}` — the middle of GitHub’s three
    options, so only an author who has not yet landed a commit in this repository needs the
    click. The endpoints #35 checked govern something else and always will:
    `.../actions/permissions` is `enabled: true, allowed_actions: all,
    sha_pinning_required: false`, and `.../actions/permissions/workflow` publishes only
    `default_workflow_permissions` and `can_approve_pull_request_reviews`.
    **The discriminator is attempt 1’s conclusion, NOT `run_attempt`** — #35 already
    recorded an approved run coming back `run_attempt: 1`, so the counter cannot answer
    this. A parked run’s `/actions/runs/{id}/attempts/1` reads `conclusion: action_required`;
    a run that was never parked has ONE attempt reading `success`, with
    `run_started_at == created_at`. MsfPablo’s first run (`32719377298`, #298, head
    `7f474b2`) has attempt 1 `action_required` and attempt 2 `success`. #304’s two runs —
    `32764969825` (`a30a74c`) and `32797158207` (`565f2a2`, post-`update-branch`) — each
    have one attempt, `success`, started the second they were created.
    **The waiver switches on at the MERGE, not at the approval — measured to the second.**
    `32719377298` was approved 2026-08-24T10:57:24Z; #298 merged 10:58:43Z; #301’s head
    `de28147` was created 10:59:09Z — 26 s later — and ran unapproved, as did every MsfPablo
    run after it (#299, #300, all three heads of #304/#305/#306 on 08-24, and all three
    post-`update-branch` heads on 08-25: `565f2a2`, `c5e44d4`, `1635592`). "One approval
    waives the rest" is refuted by the same census: `mig-builds` was parked twice (`0ef5ec3`
    08-22, `10c9592` 08-23) and `anupamme` twice (`1c20505`, `d4e586b`, both 08-21), each
    pair falling entirely before that author’s first merge.
    **Census, so the condition is not read off one case.** Every fork-originated run the API
    still returns — `gh api 'repos/antropos17/Aegis/actions/runs?event=pull_request&per_page=100&page=N'`
    over all five pages, 409 `pull_request` runs, 21 of them from forks across six
    contributors (anupamme, mig-builds, frobel0520, MsfPablo, ElshadHu, travisbreaks) —
    splits 21/21 on one line: parked while its author had no merged PR here, unparked after.
    `ElshadHu` crossed it at #26 (2026-02-19) and `travisbreaks` at #50 (2026-03-01), each
    with the same before/after shape.
    **What this does NOT retire.** (b) stands exactly as written, and this entry is why:
    mig-builds was STILL first-time when #273 was updated — the PR merged one minute after
    the second approval — so the second round was required, not redundant. (c) and (d) are
    untouched. #35 is untouched too: a release-please PR is parked because GITHUB_TOKEN
    authored the event, which no contributor history waives.
    (b) **Merging one PR invalidates the approval of every other open one.** master is
    `strict: true`, so the moment #274 merged, #273 went `behind_by: 2` and CLEAN flipped to
    BEHIND. `gh pr update-branch` fixes it while `maintainerCanModify` is true — and it
    produces a NEW head SHA whose run is `action_required` at `run_attempt: 1` all over
    again. The first approval does not carry over. This second round is the step that gets
    missed, because by then the review reads as done.
    (c) **That branch update is a merge commit, so audit its file list (#32c).** After
    `update-branch` the diff against master must still name exactly the PR’s own files, and
    each of them must be byte-identical to the pre-update head. A merge stages what it
    resolves, including files the contributor never wrote.
    (d) **A contributed test is a self-report until it is mutated.** Break one lookup the
    test actually asserts, watch it go red, restore, and confirm the tree is byte-identical
    again. Choose the target from the ASSERTIONS, not from the diff: on #273 the four
    unasserted keys would have stayed green, and reading that as vacuity would have
    condemned a sound test — it is partial coverage, which is a comment, not a rejection.

40. **A session handoff listed debts as open that master had already closed, and each was
    accepted into a plan before a blobless clone showed it done.** Found 2026-08-25, after
    #315–#319 had merged. The handoff carried three debts as pending: the app-level health
    state machine, the ai-mistakes #27 overclaim comments, and the design repo’s untracked
    session junk. Each was closed before the session began. `src/main/app-health.js` landed
    in `67536b3` (2026-08-21, inside `aegis-v0.12.0-alpha`) and
    `docs/roadmap/sensor-health-degraded.md` had already cut its open list to B5 and B8.
    `process-identity.js` was corrected in `0153aee` (2026-08-14) and `session-tracker.js`
    in `eeb0b58` (2026-08-21, PR #207), and `git grep "only failure mode" origin/master --
    src/main` returns nothing. The design repo’s `events.jsonl`, `.claude/`, `.1devtool/` and
    `.playwright-mcp/` were never tracked and have been ignored since `907e5ab` (2026-08-14).
    A fourth item — Ed25519 release signing, "status unknown, check `feat/release-signing`" —
    named a branch that exists neither locally nor on origin: #275 (merge `c52fba0`) landed
    the signing and `aegis-v0.13.0-alpha` exercised it. The handoff described an older tree
    from memory, and a plan built on it would have re-done finished work or gone looking for
    a branch that is not there (cf. #20 — do not document what is not there; #24 — derive,
    do not repeat; #28 — the sweep must reach the tree it claims to describe).
    **Rule: before assigning any inherited debt, `git show` / `git grep` the exact file on
    `origin/master`; a debt with no grep hit is closed, not pending.** A blobless clone
    (`git clone --filter=blob:none`) answers both, so the check costs less than the plan it
    replaces; a named branch is checked the same way, with `git ls-remote --heads origin
    <name>`. A handoff is a claim about the tree, and the tree is the only thing that can
    confirm it.

## Rule
NEVER change what was not asked. Do ONLY what the prompt says.