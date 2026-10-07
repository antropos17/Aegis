# Coding standards

## Modules and types

Main uses CommonJS (`require` / `module.exports`) and stays JavaScript with JSDoc. Renderer code uses ES modules (`import` / `export`); new renderer files use TypeScript without `any`.

Exported functions have JSDoc with `@param`, `@returns` and `@since`. Dependency injection uses `init(deps)`; test seams use `_setDepsForTest()` / `_resetForTest()`.

Split paths with `/[/\\]/`. OS-specific operations use the abstraction in `src/main/platform/`.

Aim for 300 lines in new files. Extract when adding to an oversized file; do not split an existing file solely to meet the target.

## Svelte

Use runes (`$state`, `$derived`, `$effect`, `$props`). Additional component behavior uses scoped CSS. Observatory's template hierarchy, shared stylesheet order and visual references are governed by [its instructions](frontend/observatory/AGENTS.md).

## Runtime invariants

Consult this section before changing process identity, snapshot-session handling or sequence rules.

A birth time is observed on the pass that stamps it or is `null`; no cache stores one. A snapshot outage freezes sessions and never splits them.

Sequence rules are consumed through five scan taps in `src/main/main.js` and `src/main/scan-loop.js`, hot-reloaded through `setupSequenceRulesWatcher` in `src/main/file-watcher.js`, and verified by `npm run verify:seq-gate`.
