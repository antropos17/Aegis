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

## PowerShell
18. Uses && in PowerShell commands instead of ; or powershell.exe -NoProfile -Command wrapper

## CI
23. Regenerates package-lock.json with the LOCAL npm and breaks every CI job. The local
    npm is 11.x; CI runs Node 20 with npm 10.8.2. npm 11 dedupes entries npm 10 still
    requires — `svelte-check/node_modules/picomatch` was hoisted away, and every job died
    at `npm ci` with "Missing: picomatch@4.0.5 from lock file" (commit `a6dccc7`, fixing
    `a91f2e1`). The lockfile is CI's input, not yours: rebuild it from master with
    `npx npm@10.8.2 install`, and verify with `npx npm@10.8.2 ci` exiting 0 before pushing.
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

## Rule
NEVER change what was not asked. Do ONLY what the prompt says.