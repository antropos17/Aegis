---
name: svelte-patterns
description: AEGIS Svelte component conventions and lifecycle guidance. Use when creating or modifying the renderer's Svelte components.
---

# AEGIS Svelte patterns

Read the actual renderer entrypoint and neighboring components. Use Svelte runes and TypeScript for new renderer components, with typed props and callback events.

    interface Props {
      selected?: boolean;
      onselect: () => void;
    }
    let { selected = false, onselect }: Props = $props();

Use $state for local reactive state and $derived for computed values. Reserve $effect for work that tracks reactive dependencies; use onMount for one-time client setup and return cleanup for timers/listeners. Use $bindable only for an intentional two-way prop contract. Prefer snippets and render tags for new composition and callback props for events.

Key dynamic lists with stable domain identities; monitoring process rows require the stamped identity rather than a reusable PID. Preserve user selection, focus and local drafts when telemetry updates.

Follow design-system for the selected implementation's tokens, styles and motion. Svelte slide transitions animate layout properties; they are not compositor-only. Prefer opacity/transform for frequent motion and honor reduced-motion settings.

A 300-line target guides new components; extract cohesive responsibilities when adding to oversized files, rather than splitting solely to meet a count. Check API details against the installed Svelte source/types or official documentation; use a documentation MCP only when available.

When the Svelte MCP is connected, follow its documentation lookup workflow and run its autofixer on changed components before completion. After fixing reported issues, check again. If it is unavailable, use local/official documentation and repository checks and state the missing MCP evidence; do not install another integration just to complete an ordinary edit.

Run the checkout's relevant typecheck and typecheck:svelte scripts and inspect the affected rendered states. Tests should exercise meaningful behavior rather than reproduce template markup.
