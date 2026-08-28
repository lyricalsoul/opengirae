<script lang="ts">
	import { Page, Navbar, NavbarBackLink, Segmented, SegmentedButton, Preloader } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { createPaginatedList } from '$lib/paginatedList.svelte';
	import CardRows from './CardRows.svelte';
	import InfiniteScrollSentinel from './InfiniteScrollSentinel.svelte';

	type Row = { id: number; name: string; imageUrl: string | null; rarityName: string; rarityEmoji: string; ownedCount: number; tradable: boolean; inAuction: boolean };
	type Tab = 'owned' | 'missing';
	type Result = { rows: Row[]; total: number; ownedCount: number; missingCount: number };
	type TradeFilter = 'all' | 'tradable' | 'nonTradable';

	const PAGE_SIZE = 20;

	let {
		subcategoryId,
		subcategoryName,
		initialIsGoal,
		viewingUserId,
		readOnly = false,
		onBack,
		onOpenActions,
	}: {
		subcategoryId: number;
		subcategoryName: string;
		initialIsGoal?: boolean;
		viewingUserId?: number;
		readOnly?: boolean;
		onBack: () => void;
		onOpenActions?: (card: Row) => void;
	} = $props();

	let tab = $state<Tab>('owned');
	let ownedCount = $state(0);
	let missingCount = $state(0);
	let isGoal = $state(initialIsGoal ?? false);
	let tradeFilter = $state<TradeFilter>('all');

	if (initialIsGoal === undefined) {
		telegramTrpc.telegram.cards.goalStatus.query({ subcategoryId }).then((result) => (isGoal = result));
	}

	const cards = createPaginatedList<Row, Result>(
		(offset) => telegramTrpc.telegram.cards.subcategoryCards.query({ subcategoryId, targetUserId: viewingUserId, ownedFilter: tab, limit: PAGE_SIZE, offset }),
		(result) => {
			ownedCount = result.ownedCount;
			missingCount = result.missingCount;
		},
	);

	$effect(() => {
		tab;
		cards.reset();
	});

	const filteredItems = $derived(
		tradeFilter === 'all' ? cards.items
			: tradeFilter === 'tradable' ? cards.items.filter(c => c.tradable)
			: cards.items.filter(c => !c.tradable)
	);

	async function toggleGoal() {
		if (isGoal) {
			await telegramTrpc.telegram.cards.goalRemove.mutate({ subcategoryId });
			isGoal = false;
		} else {
			await telegramTrpc.telegram.cards.goalAdd.mutate({ subcategoryId });
			isGoal = true;
		}
	}
</script>

<Page class="pb-safe-24">
	<Navbar title={subcategoryName}>
		{#snippet left()}
			<NavbarBackLink onclick={onBack} />
		{/snippet}
		{#snippet right()}
			<button onclick={toggleGoal} class="px-2 text-xl">{isGoal ? '⭐' : '☆'}</button>
		{/snippet}
	</Navbar>

	<div class="p-4">
		<Segmented strong>
			<SegmentedButton strong active={tab === 'owned'} onClick={() => (tab = 'owned')}>Encontrados ({ownedCount})</SegmentedButton>
			<SegmentedButton strong active={tab === 'missing'} onClick={() => (tab = 'missing')}>Não encontrados ({missingCount})</SegmentedButton>
		</Segmented>
		<div class="mt-3">
			<Segmented strong>
				<SegmentedButton strong active={tradeFilter === 'all'} onClick={() => (tradeFilter = 'all')}>Todos</SegmentedButton>
				<SegmentedButton strong active={tradeFilter === 'tradable'} onClick={() => (tradeFilter = 'tradable')}>Tradeable</SegmentedButton>
				<SegmentedButton strong active={tradeFilter === 'nonTradable'} onClick={() => (tradeFilter = 'nonTradable')}>Não tradeable</SegmentedButton>
			</Segmented>
		</div>
	</div>

	{#if cards.resetLoading}
		<div class="flex justify-center p-8"><Preloader /></div>
	{:else}
		<CardRows cards={filteredItems} {readOnly} {onOpenActions} />
		<InfiniteScrollSentinel disabled={cards.items.length >= cards.total} loading={cards.loading} onIntersect={cards.loadMore} />
	{/if}
</Page>
