---
name: aegis-context
description: AEGIS architecture and source navigation. Use when implementing, debugging, testing, or explaining AEGIS behavior, or checking technical documentation against source.
---

# AEGIS source navigation

Start with `docs/development/current-context.md` in the selected checkout. It
owns checkout selection, current entrypoints, evidence limits and history routing.
If working on an older revision without it, read that checkout's AGENTS.md,
package.json, Vite and TypeScript configs and record HEAD and dirty state.
Resolve source paths against that checkout, never the skill installation folder.
For a preserved checkout, resolve current process-policy guidance before choosing
checks or synchronizing skills; follow the policy-freshness section of current
`docs/development/current-context.md`. Keep source and policy revisions distinct.

For a source question, follow imports and actual callers from the configured
entrypoint. In main, inspect platform/index.js for OS dispatch and preload.js
with the handler and renderer consumer for IPC. Use rule-loader.js and its
callers to identify rule consumers. Read only the affected historical entries
through `memory-bank/README.md`; preserve dated receipts and active parallel work.

Derive maintained counts with `npm run counts:check` and versions from package
files. Check effective checkJs/include and per-file directives before describing
type coverage. For generated inventory scope and optional dependency graphs,
read the relevant sections of `docs/development/workflow.md`. Direct test imports
and static graphs locate candidates; they do not establish behavioral coverage
or complete runtime reachability.

When Serena is connected, activate the exact checkout by absolute path and verify
its active project before symbol queries. Use symbol definitions/references for
large files and literal search for IPC strings and computed CommonJS paths.
Svelte mode includes JS/TS. A configured server is not proof of a connection.

Use design-system for interface work, electron-main for main-process changes,
svelte-patterns for Svelte and testing for harness decisions. Commit/PR workflows
remain separate and follow the requested scope. For skill-routing evaluation,
read [trigger cases](references/trigger-cases.json); they are examples, not tasks
or evidence that an agent evaluation ran.
