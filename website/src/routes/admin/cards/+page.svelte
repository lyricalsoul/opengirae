<script lang="ts">
	import CardsGrid from '$lib/components/CardsGrid.svelte';

	let { data } = $props();
</script>

<h1 class="text-ink mb-6 text-2xl font-bold">Cartas</h1>

<CardsGrid rarities={data.rarities} categories={data.categories} />
