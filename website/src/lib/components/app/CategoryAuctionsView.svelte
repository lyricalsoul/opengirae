<script lang="ts">
	import { Page, Navbar, NavbarBackLink, Preloader } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { createPaginatedList } from '$lib/paginatedList.svelte';
	import AuctionRows from './AuctionRows.svelte';
	import InfiniteScrollSentinel from './InfiniteScrollSentinel.svelte';
	import AuctionBalanceBadge from './AuctionBalanceBadge.svelte';

	type AuctionRow = {
		auction: { id: number; startingBid: number; currentBid: number | null; expiresAt: string };
		cardName: string;
		cardImageUrl: string | null;
		rarityEmoji: string;
	};

	let {
		categoryId,
		categoryName,
		onBack,
		onOpenAuction,
	}: {
		categoryId: number;
		categoryName: string;
		onBack: () => void;
		onOpenAuction: (auctionId: number) => void;
	} = $props();

	const PAGE_SIZE = 20;
	let now = $state(Date.now());

	$effect(() => {
		const interval = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(interval);
	});

	const auctions = createPaginatedList<AuctionRow, { rows: AuctionRow[]; total: number }>((offset) =>
		telegramTrpc.telegram.auctions.list.query({ categoryId, sortBy: 'urgency', limit: PAGE_SIZE, offset }),
	);
	auctions.reset();
</script>

<Page class="pb-safe-24">
	<Navbar title={categoryName}>
		{#snippet left()}
			<NavbarBackLink onclick={onBack} />
		{/snippet}
		{#snippet right()}
			<AuctionBalanceBadge />
		{/snippet}
	</Navbar>

	{#if auctions.resetLoading}
		<div class="flex justify-center p-8"><Preloader /></div>
	{:else}
		<AuctionRows auctions={auctions.items} {now} onOpen={onOpenAuction} />
		<InfiniteScrollSentinel disabled={auctions.items.length >= auctions.total} loading={auctions.loading} onIntersect={auctions.loadMore} />
	{/if}
</Page>
