<script lang="ts">
	import { Card, Progressbar, Chip } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';

	type Progress = { subcategoryId: number; subcategoryName: string; categoryName: string; imageUrl: string | null; owned: number; total: number; isGoal: boolean };

	let { collection, onOpen }: { collection: Progress; onOpen: (c: Progress) => void } = $props();

	let complete = $derived(collection.owned === collection.total && collection.total > 0);

	async function toggleGoal(e: Event) {
		e.stopPropagation();
		if (collection.isGoal) {
			await telegramTrpc.telegram.cards.goalRemove.mutate({ subcategoryId: collection.subcategoryId });
			collection.isGoal = false;
		} else {
			await telegramTrpc.telegram.cards.goalAdd.mutate({ subcategoryId: collection.subcategoryId });
			collection.isGoal = true;
		}
	}
</script>

<Card outline onclick={() => onOpen(collection)}>
	{#snippet header()}
		{#if collection.imageUrl}
			<div
				class="ios:-mx-4 ios:-mt-4 ios:-mb-4 material:rounded-xl flex h-48 items-end bg-cover bg-center p-4 font-bold text-white"
				style={`background-image: url(${collection.imageUrl})`}
			>
				<div class="flex items-center gap-2 text-2xl" style="text-shadow: 0 0 5px rgba(0,0,0,0.5)">
					{collection.subcategoryName}
					{#if complete}<Chip outline>Completa</Chip>{/if}
					<button onclick={toggleGoal} class="text-xl">{collection.isGoal ? '⭐' : '☆'}</button>
				</div>
			</div>
		{:else}
			<div class="flex items-center gap-2 font-bold text-black dark:text-white">
				<span class="text-xl">{collection.subcategoryName}</span>
				{#if complete}<Chip outline>Completa</Chip>{/if}
				<button onclick={toggleGoal} class="text-xl">{collection.isGoal ? '⭐' : '☆'}</button>
			</div>
		{/if}
	{/snippet}
	<div class="mb-3 text-gray-500">{collection.categoryName}</div>
	<Progressbar progress={collection.total > 0 ? collection.owned / collection.total : 0} />
	<div class="mt-2 flex justify-between">
		<span>{collection.owned} / {collection.total} cards</span>
		<span>{collection.total > 0 ? Math.round((collection.owned / collection.total) * 100) : 0}%</span>
	</div>
</Card>
