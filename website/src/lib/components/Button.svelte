<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	type Props = HTMLButtonAttributes & {
		variant?: 'default' | 'danger' | 'ghost';
		children: Snippet;
	};

	let { variant = 'default', children, class: className = '', ...rest }: Props = $props();
</script>

<button {...rest} class={cn('btn', `btn-${variant}`, className)}>
	{@render children()}
</button>
