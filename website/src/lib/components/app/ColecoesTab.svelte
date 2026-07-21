<script lang="ts">
	import { Page, Navbar, Searchbar, Preloader, Segmented, SegmentedButton, List, ListItem, Toggle } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { createPaginatedList } from '$lib/paginatedList.svelte';
	import CollectionCard from './CollectionCard.svelte';
	import SubcategoryDetailView from './SubcategoryDetailView.svelte';
	import InfiniteScrollSentinel from './InfiniteScrollSentinel.svelte';
	import CardActionsSheet from './CardActionsSheet.svelte';

	type Progress = { subcategoryId: number; subcategoryName: string; categoryName: string; imageUrl: string | null; owned: number; total: number; isGoal: boolean };
	type CardRow = { id: number; name: string; imageUrl: string | null; rarityName: string; rarityEmoji: string; ownedCount: number };
	type ViewMode = 'default' | 'closest' | 'completed';

	const PAGE_SIZE = 20;

	let searchQuery = $state('');
	let viewMode = $state<ViewMode>('default');

	let hideCompletedInSearch = $state(false);
	let sortBy = $derived<'default' | 'closest'>(viewMode === 'closest' ? 'closest' : 'default');
	let completionFilter = $derived<'all' | 'incomplete' | 'completed'>(
		viewMode === 'completed' ? 'completed'
			: viewMode === 'closest' ? 'incomplete'
			: searchQuery && hideCompletedInSearch ? 'incomplete'
			: 'all',
	);
	const collections = createPaginatedList<Progress, { rows: Progress[]; total: number }>((offset) =>
		telegramTrpc.telegram.cards.overview.query({
			query: searchQuery || undefined,
			sortBy,
			completionFilter,
			limit: PAGE_SIZE,
			offset,
		}),
	);
	let detail = $state<Progress | undefined>(undefined);
	let stats = $state<{ completed: number; total: number } | undefined>(undefined);
	let actionsCard = $state<CardRow | undefined>(undefined);

	$effect(() => {
		searchQuery;
		sortBy;
		completionFilter;
		collections.reset();
	});

	telegramTrpc.telegram.cards.collectionStats.query().then((result) => (stats = result));
</script>

{#if detail}
	<SubcategoryDetailView
		subcategoryId={detail.subcategoryId}
		subcategoryName={detail.subcategoryName}
		initialIsGoal={detail.isGoal}
		onBack={() => (detail = undefined)}
		onOpenActions={(c) => (actionsCard = c)}
	/>
{:else}
	<Page class="pb-safe-24">
		<Navbar title="Coleções">
			{#snippet subnavbar()}
				<Searchbar value={searchQuery} onInput={(e: Event) => (searchQuery = (e.target as HTMLInputElement).value)} onClear={() => (searchQuery = '')} placeholder="Pesquisar..." />
			{/snippet}
		</Navbar>

		{#if searchQuery}
			<List strong outline class="m-4">
				<ListItem title="Ocultar completas">
					{#snippet after()}
						<Toggle checked={hideCompletedInSearch} onChange={(e: Event) => (hideCompletedInSearch = (e.target as HTMLInputElement).checked)} />
					{/snippet}
				</ListItem>
			</List>
		{/if}
		<div class={searchQuery ? 'p-4 pt-0' : 'p-4'}>
			<Segmented strong>
				<SegmentedButton strong active={viewMode === 'default'} onClick={() => (viewMode = 'default')}>Todas{stats ? ` (${stats.total})` : ''}</SegmentedButton>
				<SegmentedButton strong active={viewMode === 'closest'} onClick={() => (viewMode = 'closest')}>Próximas</SegmentedButton>
				<SegmentedButton strong active={viewMode === 'completed'} onClick={() => (viewMode = 'completed')}>Completas{stats ? ` (${stats.completed})` : ''}</SegmentedButton>
			</Segmented>
		</div>

		{#if collections.resetLoading}
			<div class="flex justify-center p-8"><Preloader /></div>
		{:else}
			<div class="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
				{#each collections.items as collection (collection.subcategoryId)}
					<CollectionCard {collection} onOpen={(c) => (detail = c)} />
				{/each}
			</div>
			<InfiniteScrollSentinel disabled={collections.items.length >= collections.total} loading={collections.loading} onIntersect={collections.loadMore} />
		{/if}
	</Page>
{/if}

<CardActionsSheet card={actionsCard} onClose={() => (actionsCard = undefined)} onDiscarded={() => (actionsCard = undefined)} />
