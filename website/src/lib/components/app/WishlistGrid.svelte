<script lang="ts">
	import { dndzone } from 'svelte-dnd-action';
	import type { DndEvent } from 'svelte-dnd-action';

	type Card = { id: number; name: string; imageUrl: string | null; rarityEmoji: string; rarityName: string };

	let {
		items = $bindable(),
		reorderable,
		onOpen,
		onReorder,
	}: {
		items: Card[];
		reorderable: boolean;
		onOpen: (card: Card) => void;
		onReorder: (cardIds: number[]) => void;
	} = $props();

	function handleConsider(e: CustomEvent<DndEvent<Card>>) {
		items = e.detail.items;
	}

	function handleFinalize(e: CustomEvent<DndEvent<Card>>) {
		items = e.detail.items;
		onReorder(items.map((c) => c.id));
	}
</script>

<div
	class="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4 lg:grid-cols-5"
	use:dndzone={{ items, flipDurationMs: 150, dragDisabled: !reorderable }}
	onconsider={handleConsider}
	onfinalize={handleFinalize}
>
	{#each items as card (card.id)}
		<button
			type="button"
			onclick={() => onOpen(card)}
			class="ios:rounded-2xl material:rounded-xl relative aspect-[3/4] overflow-hidden border-2 border-transparent bg-black/5 dark:bg-white/5"
		>
			{#if card.imageUrl}
				<img src={card.imageUrl} alt={card.name} loading="lazy" class="absolute inset-0 h-full w-full object-cover" />
			{/if}
		</button>
	{/each}
</div>
