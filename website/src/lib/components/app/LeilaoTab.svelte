<script lang="ts">
	import { Page, Navbar, Searchbar, Preloader, BlockTitle } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { createPaginatedList } from '$lib/paginatedList.svelte';
	import AuctionRows from './AuctionRows.svelte';
	import CategoryAuctionsView from './CategoryAuctionsView.svelte';
	import InfiniteScrollSentinel from './InfiniteScrollSentinel.svelte';
	import AuctionDetailView from './AuctionDetailView.svelte';
	import MyAuctionsView from './MyAuctionsView.svelte';
	import MyBidsView from './MyBidsView.svelte';
	import AuctionBalanceBadge from './AuctionBalanceBadge.svelte';
	import LoadError from './LoadError.svelte';
	import { createClock } from '$lib/clock.svelte';
	import type { AuctionListItem } from '$lib/auction';

	type Section = { categoryId: number; categoryName: string; categoryEmoji: string; total: number; auctions: AuctionListItem[] };

	const PAGE_SIZE = 10;

	let { initialAuctionId }: { initialAuctionId?: number } = $props();

	let searchQuery = $state('');
	// the list reloads off this, not off every keystroke
	let debouncedQuery = $state('');
	let selectedId = $state<number | undefined>(initialAuctionId);
	let detailCategory = $state<{ categoryId: number; categoryName: string } | undefined>(undefined);
	let myAuctionsOpen = $state(false);
	let myBidsOpen = $state(false);
	const clock = createClock();

	const sections = createPaginatedList<Section, { rows: Section[]; total: number }>((offset) =>
		telegramTrpc.telegram.auctions.byCategory.query({ query: debouncedQuery || undefined, limit: PAGE_SIZE, offset }),
	);

	$effect(() => {
		const q = searchQuery;
		const timer = setTimeout(() => (debouncedQuery = q), 300);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		debouncedQuery;
		sections.reset();
	});

	function onBack() {
		detailCategory = undefined;
		sections.reset();
	}
</script>

{#if selectedId}
	<AuctionDetailView auctionId={selectedId} onBack={() => (selectedId = undefined)} onChanged={() => sections.reset()} />
{:else if detailCategory}
	<CategoryAuctionsView
		categoryId={detailCategory.categoryId}
		categoryName={detailCategory.categoryName}
		{onBack}
		onOpenAuction={(id) => (selectedId = id)}
	/>
{:else if myAuctionsOpen}
	<MyAuctionsView onBack={() => (myAuctionsOpen = false)} onOpenAuction={(id) => (selectedId = id)} />
{:else if myBidsOpen}
	<MyBidsView onBack={() => (myBidsOpen = false)} onOpenAuction={(id) => (selectedId = id)} />
{:else}
	<Page class="pb-safe-24">
		<Navbar title="Leilão">
			{#snippet right()}
				<AuctionBalanceBadge />
			{/snippet}
			{#snippet subnavbar()}
				<Searchbar
					value={searchQuery}
					onInput={(e: Event) => (searchQuery = (e.target as HTMLInputElement).value)}
					onClear={() => (searchQuery = '')}
					placeholder="Este card está em leilão?"
				/>
			{/snippet}
		</Navbar>

		<div class="flex gap-2 px-4 pt-4">
			<button
				type="button"
				onclick={() => (myAuctionsOpen = true)}
				class="flex-1 rounded-full bg-black/5 px-4 py-2 text-center text-sm font-semibold text-black dark:bg-white/10 dark:text-white"
			>
				Meus leilões
			</button>
			<button
				type="button"
				onclick={() => (myBidsOpen = true)}
				class="flex-1 rounded-full bg-black/5 px-4 py-2 text-center text-sm font-semibold text-black dark:bg-white/10 dark:text-white"
			>
				A licitar
			</button>
		</div>

		{#if sections.resetLoading}
			<div class="flex justify-center p-8"><Preloader /></div>
		{:else if sections.error && sections.items.length === 0}
			<LoadError onRetry={sections.reset} />
		{:else if sections.items.length === 0}
			<div class="p-8 text-center text-black/55 dark:text-white/55">
				{searchQuery ? 'Nenhum leilão ativo com esse card.' : 'Nenhum leilão ativo agora.'}
			</div>
		{:else}
			{#each sections.items as section (section.categoryId)}
				<BlockTitle>{section.categoryEmoji} {section.categoryName}</BlockTitle>
				<AuctionRows
					auctions={section.auctions}
					now={clock.now}
					onOpen={(id) => (selectedId = id)}
					onSeeMore={section.total > section.auctions.length
						? () => (detailCategory = { categoryId: section.categoryId, categoryName: section.categoryName })
						: undefined}
				/>
			{/each}
			<InfiniteScrollSentinel disabled={sections.items.length >= sections.total} loading={sections.loading} onIntersect={sections.loadMore} />
		{/if}
	</Page>
{/if}
