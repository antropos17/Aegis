# Other Template Directives

## {@html ...}

Renders raw HTML strings. **Use with caution** - never render untrusted content.

```svelte
<script>
	let htmlContent = '<strong>Bold</strong> and <em>italic</em>';
</script>

{@html htmlContent}
```

### Security Warning

Always sanitize user-provided HTML:

```svelte
<script>
	import DOMPurify from 'dompurify';

	let userContent = $state('');
	const sanitized = $derived(DOMPurify.sanitize(userContent));
</script>

{@html sanitized}
```

### Common Use Cases

- Rendering markdown converted to HTML
- CMS content with formatting
- Syntax-highlighted code blocks

## {@render ...}

Renders snippets - Svelte 5's replacement for slots.

```svelte
<script>
	let { header, children } = $props();
</script>

<div class="card">
	{#if header}
		<header>{@render header()}</header>
	{/if}
	<main>{@render children?.()}</main>
</div>
```

### With Parameters

Snippets can receive parameters:

```svelte
<script>
	let { row } = $props();
	let items = $state([{ name: 'Apple' }, { name: 'Banana' }]);
</script>

{#each items as item}
	{@render row(item)}
{/each}
```

```svelte
<!-- Usage -->
<List>
	{#snippet row(item)}
		<li>{item.name}</li>
	{/snippet}
</List>
```

### Optional Snippets

Use optional chaining for optional snippets:

```svelte
{@render footer?.()}
```

## {@const ...}

Declares local constants within template blocks. Useful in `{#each}` and
`{#if}`.

```svelte
{#each items as item}
	{@const fullName = `${item.firstName} ${item.lastName}`}
	{@const isLongName = fullName.length > 20}

	<div class:truncate={isLongName}>
		{fullName}
	</div>
{/each}
```

### Why Use @const?

- Avoids recalculating values multiple times in a block
- Makes complex expressions more readable
- Scoped to the block - doesn't pollute component scope

## {@debug ...}

Pauses execution and opens devtools when specified values change.

```svelte
<script>
	let count = $state(0);
	let items = $state([]);
</script>

{@debug count, items}

<button onclick={() => count++}>Increment</button>
```

### Tips

- Remove `{@debug}` before production
- Use with specific variables, not entire objects
- Combine with browser devtools for best debugging experience

### Debug Without Variables

```svelte
{@debug}
```

Pauses on every update (rarely useful, but available).
