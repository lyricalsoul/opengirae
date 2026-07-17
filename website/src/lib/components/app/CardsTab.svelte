<script lang="ts">
	import { Page, Navbar, Searchbar, Link, Preloader, BlockTitle } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { createPaginatedList } from '$lib/paginatedList.svelte';
	import CardRows from './CardRows.svelte';
	import CardActionsSheet from './CardActionsSheet.svelte';
	import BulkDiscardBar from './BulkDiscardBar.svelte';
	import SubcategoryDetailView from './SubcategoryDetailView.svelte';
	import InfiniteScrollSentinel from './InfiniteScrollSentinel.svelte';

	type CardRow = { id: number; name: string; imageUrl: string | null; rarityName: string; rarityEmoji: string; ownedCount: number };
	type Section = { subcategoryId: number; subcategoryName: string; categoryEmoji: string; categoryName: string; total: number; cards: CardRow[] };

	const PAGE_SIZE = 10; 

	let searchQuery = $state('');
	const sections = createPaginatedList<Section, { rows: Section[]; total: number }>((offset) =>
		telegramTrpc.telegram.cards.bySubcategory.query({ query: searchQuery || undefined, limit: PAGE_SIZE, offset }),
	);

	let selectionMode = $state(false);
	let selectedIds = $state(new Set<number>());
	let actionsCard = $state<CardRow | undefined>(undefined);
	let detailSection = $state<{ subcategoryId: number; subcategoryName: string } | undefined>(undefined);

	$effect(() => {
		searchQuery;
		sections.reset();
	});

	let visibleCards = $derived(sections.items.flatMap((s) => s.cards));
	let selectedCards = $derived(visibleCards.filter((c) => selectedIds.has(c.id)));

	function toggleSelect(cardId: number) {
		const next = new Set(selectedIds);
		if (next.has(cardId)) next.delete(cardId);
		else next.add(cardId);
		selectedIds = next;
	}

	function onBulkDone() {
		selectionMode = false;
		selectedIds = new Set();
		sections.reset();
	}

	function onSingleDiscarded(cardId: number) {
		sections.items = sections.items.map((s) => ({ ...s, cards: s.cards.filter((c) => c.id !== cardId) }));
	}

	function onBack() {
		detailSection = undefined;
		sections.reset();
	}
</script>

{#if detailSection}
	<SubcategoryDetailView
		subcategoryId={detailSection.subcategoryId}
		subcategoryName={detailSection.subcategoryName}
		{onBack}
		onOpenActions={(c) => (actionsCard = c)}
	/>
{:else}
	<Page class="pb-safe-24">
		<Navbar title="Cards">
			{#snippet right()}
				<Link onClick={() => (selectionMode = !selectionMode)}>{selectionMode ? 'Cancelar' : 'Selecionar'}</Link>
			{/snippet}
			{#snippet subnavbar()}
				<Searchbar value={searchQuery} onInput={(e: Event) => (searchQuery = (e.target as HTMLInputElement).value)} onClear={() => (searchQuery = '')} placeholder="Pesquisar..." />
			{/snippet}
		</Navbar>

		{#if sections.resetLoading}
			<div class="flex justify-center p-8"><Preloader /></div>
		{:else}
			{#each sections.items as section (section.subcategoryId)}
				<BlockTitle>
					<span>{section.categoryEmoji} {section.subcategoryName}</span>
					{#if section.total > section.cards.length}
						<Link onClick={() => (detailSection = section)}>Ver mais</Link>
					{/if}
				</BlockTitle>
				<CardRows
					cards={section.cards}
					{selectionMode}
					{selectedIds}
					onToggleSelect={toggleSelect}
					onOpenActions={(c) => (actionsCard = c)}
				/>
			{/each}
			<InfiniteScrollSentinel disabled={sections.items.length >= sections.total} loading={sections.loading} onIntersect={sections.loadMore} />
		{/if}
	</Page>
{/if}

<CardActionsSheet card={actionsCard} onClose={() => (actionsCard = undefined)} onDiscarded={onSingleDiscarded} />

{#if selectionMode && selectedCards.length > 0}
	<BulkDiscardBar selectedCards={selectedCards} onDone={onBulkDone} />
{/if}
