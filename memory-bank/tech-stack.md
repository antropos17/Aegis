# AEGIS Tech Stack

## Core
- Electron 33 (desktop framework)
- Svelte 5 + Vite (frontend, renderer process)
- Vanilla JS + CommonJS (backend, main process)

## Почему Svelte
- Компилируется в vanilla JS — нет runtime overhead
- Scoped CSS — нет конфликтов стилей
- $state/$derived — реактивность без boilerplate
- Svelte MCP — Claude Code валидирует код автоматически

## Модульные системы
- Main process (src/main/): CommonJS — require/module.exports
- Renderer (src/renderer/): ES modules — import/export (Svelte)

## Зависимости
- chokidar@3 — file watching
- electron — desktop shell
- svelte + vite + @sveltejs/vite-plugin-svelte — frontend build

## Шрифты
- Outfit (headings)
- DM Sans (body)