---
name: svelte-patterns
description: Svelte 5 runes, component patterns, template directives for Aegis renderer. Use when creating or editing .svelte files.
---
# Svelte 5 Patterns for Aegis

## Runes
- $state() for reactive state
- $derived() for computed values
- $effect() for side effects (replaces onMount for reactive deps)
- $props() for component props with defaults
- $bindable() for two-way binding

## Component Patterns
- One component per file, max 300 lines
- Props interface at top: let { prop1 = default, prop2 } = $props()
- Event dispatch via callback props, not createEventDispatcher
- Slots via {#snippet} and {@render}

## Template Directives
- {#if}/{:else if}/{:else} — conditional rendering
- {#each items as item (item.id)} — keyed lists
- {#await promise} — async data
- use:action — Svelte actions for DOM manipulation
- transition:fade|slide — built-in transitions (GPU only)

For latest Svelte 5 API: use Context7 MCP → @sveltejs/svelte docs
