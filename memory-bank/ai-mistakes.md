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

## Caching
26. Treats a cache KEY as proof that cached data is still fresh. A key is a LOCATOR —
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
    time still matches. Residual bound, documented not hidden: a pid reuse landing in the
    same stored epoch-millisecond collides on the generation token itself and stays
    indistinguishable (process-identity.js TIME RESOLUTION).

## Rule
NEVER change what was not asked. Do ONLY what the prompt says.