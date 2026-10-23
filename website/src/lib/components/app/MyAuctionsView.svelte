<script lang="ts">
	import { Page, Navbar, NavbarBackLink, Preloader, List } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { createPaginatedList } from '$lib/paginatedList.svelte';
	import { AUCTION_STATUS_LABEL, type AuctionListItem } from '$lib/auction';
	import AuctionListRow from './AuctionListRow.svelte';
	import AuctionStatusChip from './AuctionStatusChip.svelte';
	import InfiniteScrollSentinel from './InfiniteScrollSentinel.svelte';
	import AuctionBalanceBadge from './AuctionBalanceBadge.svelte';
	import LoadError from './LoadError.svelte';

	const STATUS_TONE = { active: 'neutral', sold: 'good', expired: 'muted', cancelled: 'bad' } as const;

	let { onBack, onOpenAuction }: { onBack: () => void; onOpenAuction: (auctionId: number) => void } = $props();

	const PAGE_SIZE = 20;

	const auctions = createPaginatedList<AuctionListItem, { rows: AuctionListItem[]; total: number }>((offset) =>
		telegramTrpc.telegram.auctions.mine.query({ limit: PAGE_SIZE, offset }),
	);
	auctions.reset();
</script>

<Page class="pb-safe-24">
	<Navbar title="Meus leilões">
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
	{:else if auctions.items.length === 0}
		<div class="p-8 text-center text-black/55 dark:text-white/55">Você ainda não criou nenhum leilão.</div>
	{:else}
		<List strong outline>
			{#each auctions.items as row (row.auction.id)}
				{@const status = row.auction.status ?? 'active'}
				<AuctionListRow
					imageUrl={row.cardImageUrl}
					title={`${row.rarityEmoji} ${row.cardName}`}
					price={row.auction.currentBid ?? row.auction.startingBid}
					onclick={() => onOpenAuction(row.auction.id)}
				>
					{#snippet subtitle()}
						<AuctionStatusChip label={AUCTION_STATUS_LABEL[status] ?? status} tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? 'neutral'} />
					{/snippet}
				</AuctionListRow>
			{/each}
		</List>
		<InfiniteScrollSentinel disabled={auctions.items.length >= auctions.total} loading={auctions.loading} onIntersect={auctions.loadMore} />
	{/if}
</Page>
