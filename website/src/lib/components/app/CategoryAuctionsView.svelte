<script lang="ts">
	import { Page, Navbar, NavbarBackLink, Preloader } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { createPaginatedList } from '$lib/paginatedList.svelte';
	import AuctionRows from './AuctionRows.svelte';
	import LoadError from './LoadError.svelte';
	import { createClock } from '$lib/clock.svelte';
	import type { AuctionListItem } from '$lib/auction';
	import InfiniteScrollSentinel from './InfiniteScrollSentinel.svelte';
	import AuctionBalanceBadge from './AuctionBalanceBadge.svelte';

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
	const clock = createClock();

	const auctions = createPaginatedList<AuctionListItem, { rows: AuctionListItem[]; total: number }>((offset) =>
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
	{:else if auctions.error && auctions.items.length === 0}
		<LoadError onRetry={auctions.reset} />
	{:else}
		<AuctionRows auctions={auctions.items} now={clock.now} onOpen={onOpenAuction} />
		<InfiniteScrollSentinel disabled={auctions.items.length >= auctions.total} loading={auctions.loading} onIntersect={auctions.loadMore} />
	{/if}
</Page>
