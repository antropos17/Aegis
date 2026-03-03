---
name: electron-main
description: Electron main process patterns for Aegis. CJS modules, platform abstraction, IPC, file watchers. Use when editing src/main/ files.
---
# Electron Main Process

## Architecture
- 21 CJS modules loaded directly by Node.js (NO build step)
- Platform dispatcher: src/main/platform/index.js → win32|darwin|linux
- IPC: 43 invoke + 10 push channels, scan-batch consolidation
- File watcher: chokidar 3.6, function-form ignored (NOT glob)

## Rules
- require() / module.exports only
- JSDoc annotations with types from src/shared/types/
- Stay .js until P5-C (tsc build step)
- Staggered startup: 3/8/12s intervals
- Stats-update batcher: 1000ms debounce
