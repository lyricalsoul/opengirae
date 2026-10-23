<script lang="ts">
	import { List } from 'konsta/svelte';
	import { formatTimeLeft, type AuctionListItem } from '$lib/auction';
	import AuctionListRow from './AuctionListRow.svelte';

	let { auctions, now, onOpen, onSeeMore }: { auctions: AuctionListItem[]; now: number; onOpen: (auctionId: number) => void; onSeeMore?: () => void } = $props();
</script>

<List strong outline>
	{#each auctions as row (row.auction.id)}
		<AuctionListRow
			imageUrl={row.cardImageUrl}
			title={row.cardName}
			price={row.auction.currentBid ?? row.auction.startingBid}
			onclick={() => onOpen(row.auction.id)}
		>
			{#snippet subtitle()}
				<div class="truncate text-sm text-black/55 dark:text-white/55">{row.rarityEmoji} ⏳ {formatTimeLeft(row.auction.expiresAt, now)}</div>
			{/snippet}
		</AuctionListRow>
	{/each}
	{#if onSeeMore}
		<li class="hairline-b last:hairline-b-none relative overflow-hidden">
			<button
				type="button"
				onclick={onSeeMore}
				class="flex w-full items-center justify-center px-4 py-3 text-sm font-semibold text-primary transition-colors duration-150 active:scale-[0.99] active:duration-0"
			>
				Ver mais
			</button>
		</li>
	{/if}
</List>
