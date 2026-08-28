<script lang="ts">
	import { Page, Navbar, NavbarBackLink, Preloader, List } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { createPaginatedList } from '$lib/paginatedList.svelte';
	import InfiniteScrollSentinel from './InfiniteScrollSentinel.svelte';
	import AuctionBalanceBadge from './AuctionBalanceBadge.svelte';

	type AuctionRow = {
		auction: { id: number; startingBid: number; currentBid: number | null; status: string };
		cardName: string;
		cardImageUrl: string | null;
		rarityEmoji: string;
		isLeading: boolean;
	};

	const STATUS_LABEL: Record<string, string> = {
		sold: 'Vendido',
		expired: 'Expirado',
		cancelled: 'Cancelado',
	};

	const STATUS_CLASS: Record<string, string> = {
		sold: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
		expired: 'bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50',
		cancelled: 'bg-red-500/15 text-red-500',
	};

	let { onBack, onOpenAuction }: { onBack: () => void; onOpenAuction: (auctionId: number) => void } = $props();

	const PAGE_SIZE = 20;

	const auctions = createPaginatedList<AuctionRow, { rows: AuctionRow[]; total: number }>((offset) =>
		telegramTrpc.telegram.auctions.bidding.query({ limit: PAGE_SIZE, offset }),
	);
	auctions.reset();
</script>

<Page class="pb-safe-24">
	<Navbar title="A licitar">
		{#snippet left()}
			<NavbarBackLink onclick={onBack} />
		{/snippet}
		{#snippet right()}
			<AuctionBalanceBadge />
		{/snippet}
	</Navbar>

	{#if auctions.resetLoading}
		<div class="flex justify-center p-8"><Preloader /></div>
	{:else if auctions.items.length === 0}
		<div class="p-8 text-center text-black/55 dark:text-white/55">Você ainda não deu nenhum lance.</div>
	{:else}
		<List strong outline>
			{#each auctions.items as row (row.auction.id)}
				<li class="hairline-b last:hairline-b-none relative overflow-hidden">
					<button
						type="button"
						onclick={() => onOpenAuction(row.auction.id)}
						class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 active:scale-[0.99] active:duration-0"
					>
						{#if row.cardImageUrl}
							<div class="aspect-3/4 w-12 shrink-0 rounded-lg bg-cover bg-center" style={`background-image: url(${row.cardImageUrl})`}></div>
						{:else}
							<div class="aspect-3/4 w-12 shrink-0 rounded-lg bg-black/10 dark:bg-white/10"></div>
						{/if}
						<div class="ml-1 min-w-0 flex-1">
							<div class="truncate font-semibold text-black dark:text-white">{row.rarityEmoji} {row.cardName}</div>
							{#if row.auction.status === 'active'}
								<span class={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${row.isLeading ? 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400' : 'bg-red-500/15 text-red-500'}`}>
									{row.isLeading ? '👑 Você lidera' : 'Superado'}
								</span>
							{:else}
								<span class={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[row.auction.status] ?? ''}`}>
									{row.isLeading && row.auction.status === 'sold' ? 'Você ganhou' : (STATUS_LABEL[row.auction.status] ?? row.auction.status)}
								</span>
							{/if}
						</div>
						<div class="shrink-0 text-right text-sm font-semibold text-black dark:text-white">
							{(row.auction.currentBid ?? row.auction.startingBid).toLocaleString('en-US')}
							<div class="text-xs font-normal text-black/55 dark:text-white/55">moedas</div>
						</div>
					</button>
				</li>
			{/each}
		</List>
		<InfiniteScrollSentinel disabled={auctions.items.length >= auctions.total} loading={auctions.loading} onIntersect={auctions.loadMore} />
	{/if}
</Page>
