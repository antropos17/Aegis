# AEGIS Tech Stack

## Core
- Electron 43 (desktop framework)
- Svelte 5 + Vite (frontend, renderer process)
- Vanilla JS + CommonJS (backend, main process)

## Why Svelte
- Compiles to vanilla JS — no runtime overhead
- Scoped CSS — no style conflicts
- $state/$derived — reactivity without boilerplate
- Svelte MCP — Claude Code validates the code automatically

## Module systems
- Main process (src/main/): CommonJS — require/module.exports
- Renderer (src/renderer/): ES modules — import/export (Svelte)

## Dependencies
- chokidar@3 — file watching
- electron — desktop shell
- svelte + vite + @sveltejs/vite-plugin-svelte — frontend build

## Fonts
- Outfit (headings)
- DM Sans (body)