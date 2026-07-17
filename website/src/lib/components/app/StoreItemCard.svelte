<script lang="ts">
	import { Card } from 'konsta/svelte';

	type Item = { id: number; title: string; description: string; price: number; itemURL: string };

	let {
		item,
		owned,
		equipped,
		onOpen,
	}: { item: Item; owned: boolean; equipped: boolean; onOpen: (item: Item) => void } = $props();

	let status = $derived(equipped ? 'Equipado' : owned ? 'Comprado' : `${item.price} moedas`);
</script>

<Card outline class="m-0!" onclick={() => onOpen(item)}>
	{#snippet header()}
		<div
			class="ios:-mx-4 ios:-mt-4 ios:-mb-4 material:rounded-xl aspect-3/1 bg-cover bg-center"
			style={`background-image: url(${item.itemURL})`}
		></div>
	{/snippet}
	<div class="min-w-0">
		<div class="truncate font-bold text-black dark:text-white">{item.title}</div>
		<div class="truncate text-sm text-black/55 dark:text-white/55">{item.description}</div>
	</div>
	<div class="mt-2 text-sm font-bold text-black/55 dark:text-white/55">{status}</div>
</Card>
