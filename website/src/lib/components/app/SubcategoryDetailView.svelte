<script lang="ts">
	import { Page, Navbar, NavbarBackLink, Segmented, SegmentedButton, Preloader } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { createPaginatedList } from '$lib/paginatedList.svelte';
	import CardRows from './CardRows.svelte';
	import InfiniteScrollSentinel from './InfiniteScrollSentinel.svelte';

	type Row = { id: number; name: string; imageUrl: string | null; rarityName: string; rarityEmoji: string; ownedCount: number };
	type Tab = 'owned' | 'missing';
	type Result = { rows: Row[]; total: number; ownedCount: number; missingCount: number };

	const PAGE_SIZE = 20;

	let {
		subcategoryId,
		subcategoryName,
		onBack,
		onOpenActions,
	}: {
		subcategoryId: number;
		subcategoryName: string;
		onBack: () => void;
		onOpenActions?: (card: Row) => void;
	} = $props();

	let tab = $state<Tab>('owned');
	let ownedCount = $state(0);
	let missingCount = $state(0);

	const cards = createPaginatedList<Row, Result>(
		(offset) => telegramTrpc.telegram.cards.subcategoryCards.query({ subcategoryId, ownedFilter: tab, limit: PAGE_SIZE, offset }),
		(result) => {
			ownedCount = result.ownedCount;
			missingCount = result.missingCount;
		},
	);

	$effect(() => {
		tab;
		cards.reset();
	});
</script>

<Page class="pb-safe-24">
	<Navbar title={subcategoryName}>
		{#snippet left()}
			<NavbarBackLink onclick={onBack} />
		{/snippet}
	</Navbar>

	<div class="p-4">
		<Segmented strong>
			<SegmentedButton strong active={tab === 'owned'} onClick={() => (tab = 'owned')}>Encontrados ({ownedCount})</SegmentedButton>
			<SegmentedButton strong active={tab === 'missing'} onClick={() => (tab = 'missing')}>Não encontrados ({missingCount})</SegmentedButton>
		</Segmented>
	</div>

	{#if cards.resetLoading}
		<div class="flex justify-center p-8"><Preloader /></div>
	{:else}
		<CardRows cards={cards.items} {onOpenActions} />
		<InfiniteScrollSentinel disabled={cards.items.length >= cards.total} loading={cards.loading} onIntersect={cards.loadMore} />
	{/if}
</Page>
