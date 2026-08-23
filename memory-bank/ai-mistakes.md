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

## Rule
NEVER change what was not asked. Do ONLY what the prompt says.