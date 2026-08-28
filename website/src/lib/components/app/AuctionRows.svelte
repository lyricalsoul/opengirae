<script lang="ts">
	import { List } from 'konsta/svelte';

	// expiresAt arrives as an ISO string over the wire - see LeilaoTab.svelte's note.
	type AuctionRow = {
		auction: { id: number; startingBid: number; currentBid: number | null; expiresAt: string };
		cardName: string;
		cardImageUrl: string | null;
		rarityEmoji: string;
	};

	let { auctions, now, onOpen, onSeeMore }: { auctions: AuctionRow[]; now: number; onOpen: (auctionId: number) => void; onSeeMore?: () => void } = $props();

	function timeLeft(expiresAt: string): string {
		const ms = new Date(expiresAt).getTime() - now;
		if (ms <= 0) return 'Terminando...';
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		if (hours > 0) return `${hours}h ${minutes}min`;
		return `${minutes}min ${String(totalSeconds % 60).padStart(2, '0')}s`;
	}
</script>

<List strong outline>
	{#each auctions as row (row.auction.id)}
		<li class="hairline-b last:hairline-b-none relative overflow-hidden">
			<button
				type="button"
				onclick={() => onOpen(row.auction.id)}
				class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 active:scale-[0.99] active:duration-0"
			>
				{#if row.cardImageUrl}
					<div class="aspect-3/4 w-12 shrink-0 rounded-lg bg-cover bg-center" style={`background-image: url(${row.cardImageUrl})`}></div>
				{:else}
					<div class="aspect-3/4 w-12 shrink-0 rounded-lg bg-black/10 dark:bg-white/10"></div>
				{/if}
				<div class="ml-1 min-w-0 flex-1">
					<div class="truncate font-semibold text-black dark:text-white">{row.cardName}</div>
					<div class="truncate text-sm text-black/55 dark:text-white/55">{row.rarityEmoji} ⏳ {timeLeft(row.auction.expiresAt)}</div>
				</div>
				<div class="shrink-0 text-right text-sm font-semibold text-black dark:text-white">
					{(row.auction.currentBid ?? row.auction.startingBid).toLocaleString('en-US')}
					<div class="text-xs font-normal text-black/55 dark:text-white/55">moedas</div>
				</div>
			</button>
		</li>
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
