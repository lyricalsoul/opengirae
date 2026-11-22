<script lang="ts">
	import type { Snippet } from 'svelte';
	import { bgImage } from '$lib/css';

	let { imageUrl, title, price, onclick, subtitle }: { imageUrl: string | null; title: string; price: number; onclick: () => void; subtitle: Snippet } = $props();
</script>

<li class="hairline-b last:hairline-b-none relative overflow-hidden">
	<button
		type="button"
		{onclick}
		class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 active:scale-[0.99] active:duration-0"
	>
		{#if imageUrl}
			<div class="aspect-3/4 w-12 shrink-0 rounded-lg bg-cover bg-center" style={bgImage(imageUrl)}></div>
		{:else}
			<div class="aspect-3/4 w-12 shrink-0 rounded-lg bg-black/10 dark:bg-white/10"></div>
		{/if}
		<div class="ml-1 min-w-0 flex-1">
			<div class="truncate font-semibold text-black dark:text-white">{title}</div>
			{@render subtitle()}
		</div>
		<div class="shrink-0 text-right text-sm font-semibold text-black dark:text-white">
			{price.toLocaleString('en-US')}
			<div class="text-xs font-normal text-black/55 dark:text-white/55">moedas</div>
		</div>
	</button>
</li>
