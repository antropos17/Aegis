---
name: electron-main
description: 'AEGIS Electron main-process conventions for src/main changes: CommonJS, platform dispatch, IPC, watchers and batching.'
---

# Electron main process

Main modules use CommonJS and JavaScript with JSDoc. Follow AGENTS.md and inspect effective TypeScript settings before claiming body-level type coverage. Derive dependency versions from package.json.

- Route OS-specific operations through src/main/platform/index.js and the matching platform module.
- Check both the main handler and src/main/preload.js when changing IPC contracts; retain channel/input validation and the narrow contextBridge surface.
- Read scan-loop.js for staggered startup, scan intervals and shutdown cleanup. Those are separate scheduling mechanisms; preserve their lifecycle instead of copying fixed delays into new code.
- Read ipc-batcher.js and its callers for flush mode, capacity and timing. The stats-update caller uses latest-value batching: a pending flush timer is not restarted on every event. Do not replace it with trailing debounce that can postpone delivery indefinitely.
- Follow each chokidar watcher's actual ignored predicate and path semantics in file-watcher.js; the installed library accepting globs does not make a glob equivalent to that predicate.
- Reuse existing init(deps), _setDepsForTest() and _resetForTest() seams where present. Preserve stamped identity and outage invariants from CODING_STANDARDS.md when changing monitoring behavior.

Keep watched secret contents and provider credentials out of logs, IPC payloads and exports. Verify the affected behavior with focused tests and the required project checks.
