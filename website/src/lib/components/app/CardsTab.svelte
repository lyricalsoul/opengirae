<script lang="ts">
	import { Page, Navbar, Searchbar, Link, Preloader, BlockTitle, Segmented, SegmentedButton } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { createPaginatedList } from '$lib/paginatedList.svelte';
	import CardRows from './CardRows.svelte';
	import CardActionsSheet from './CardActionsSheet.svelte';
	import WishlistGrid from './WishlistGrid.svelte';
	import WishlistActionsSheet from './WishlistActionsSheet.svelte';
	import BulkDiscardBar from './BulkDiscardBar.svelte';
	import SubcategoryDetailView from './SubcategoryDetailView.svelte';
	import InfiniteScrollSentinel from './InfiniteScrollSentinel.svelte';

	type CardRow = { id: number; name: string; imageUrl: string | null; rarityName: string; rarityEmoji: string; ownedCount: number };
	type Section = { subcategoryId: number; subcategoryName: string; categoryEmoji: string; categoryName: string; total: number; cards: CardRow[] };
	type WishlistCard = { id: number; name: string; imageUrl: string | null; rarityName: string; rarityEmoji: string };

	const PAGE_SIZE = 10;
	const WISHLIST_PAGE_SIZE = 25;

	let { viewingUserId }: { viewingUserId?: number } = $props();

	let targetInfo = $state<{ displayName: string; isSelf: boolean; viewable: boolean } | undefined>(undefined);
	$effect(() => {
		if (viewingUserId === undefined) { targetInfo = undefined; return; }
		telegramTrpc.telegram.cards.targetInfo.query({ targetUserId: viewingUserId }).then((info) => (targetInfo = info));
	});
	let readOnly = $derived(!!targetInfo && !targetInfo.isSelf);
	let blocked = $derived(!!targetInfo && !targetInfo.viewable);
	const targetUserIdForQuery = () => (targetInfo && !targetInfo.isSelf ? viewingUserId : undefined);

	type ViewMode = 'cards' | 'wishlist';
	let viewMode = $state<ViewMode>('cards');

	let searchQuery = $state('');
	const sections = createPaginatedList<Section, { rows: Section[]; total: number }>((offset) =>
		telegramTrpc.telegram.cards.bySubcategory.query({ query: searchQuery || undefined, limit: PAGE_SIZE, offset, targetUserId: targetUserIdForQuery() }),
	);
	const wishlist = createPaginatedList<WishlistCard, { rows: WishlistCard[]; total: number }>((offset) =>
		telegramTrpc.telegram.cards.wishlist.query({ limit: WISHLIST_PAGE_SIZE, offset, targetUserId: targetUserIdForQuery() }),
	);

	let wishlistQuery = $state('');
	const catalogSearch = createPaginatedList<WishlistCard, { rows: WishlistCard[]; total: number }>((offset) =>
		telegramTrpc.telegram.cards.cardSearch.query({ query: wishlistQuery, limit: WISHLIST_PAGE_SIZE, offset }),
	);
	let browsingWishlist = $derived(!wishlistQuery.trim());

	let selectionMode = $state(false);
	let selectedIds = $state(new Set<number>());
	let quantities = $state<Record<number, number>>({});
	let actionsCard = $state<CardRow | undefined>(undefined);
	let wishlistActionsCard = $state<WishlistCard | undefined>(undefined);
	let detailSection = $state<{ subcategoryId: number; subcategoryName: string } | undefined>(undefined);

	let targetReady = $derived(viewingUserId === undefined || !!targetInfo);

	$effect(() => {
		searchQuery;
		if (targetReady && !blocked) sections.reset();
	});

	$effect(() => {
		if (targetReady && !blocked && viewMode === 'wishlist' && wishlist.items.length === 0) wishlist.reset();
	});

	$effect(() => {
		wishlistQuery;
		if (!readOnly && !browsingWishlist) catalogSearch.reset();
	});

	function onWishlistReorder(cardIds: number[]) {
		if (readOnly) return;
		telegramTrpc.telegram.cards.wishlistReorder.mutate({ cardIds });
	}

	function onWishlistCardChanged(card: WishlistCard, onWishlist: boolean) {
		if (onWishlist) {
			if (!wishlist.items.some((c) => c.id === card.id)) {
				wishlist.items = [...wishlist.items, card];
				wishlist.total += 1;
			}
		} else {
			if (wishlist.items.some((c) => c.id === card.id)) {
				wishlist.items = wishlist.items.filter((c) => c.id !== card.id);
				wishlist.total -= 1;
			}
		}
	}

	let visibleCards = $derived(sections.items.flatMap((s) => s.cards));
	let selectedCards = $derived(visibleCards.filter((c) => selectedIds.has(c.id)));

	function toggleSelect(cardId: number) {
		const next = new Set(selectedIds);
		if (next.has(cardId)) {
			next.delete(cardId);
			const { [cardId]: _removed, ...rest } = quantities;
			quantities = rest;
		} else {
			next.add(cardId);
			quantities = { ...quantities, [cardId]: 1 };
		}
		selectedIds = next;
	}

	function setQuantity(cardId: number, quantity: number) {
		quantities = { ...quantities, [cardId]: quantity };
	}

	function toggleSelectionMode() {
		selectionMode = !selectionMode;
		if (!selectionMode) {
			selectedIds = new Set();
			quantities = {};
		}
	}

	function onBulkDone() {
		selectionMode = false;
		selectedIds = new Set();
		quantities = {};
		sections.reset();
	}

	function onSingleDiscarded(cardId: number, _coinsAwarded: number, remainingCount: number) {
		sections.items = sections.items.map((s) => ({
			...s,
			cards: remainingCount > 0
				? s.cards.map((c) => (c.id === cardId ? { ...c, ownedCount: remainingCount } : c))
				: s.cards.filter((c) => c.id !== cardId),
		}));
	}

	function onBack() {
		detailSection = undefined;
		sections.reset();
	}
</script>

{#if viewingUserId !== undefined && !targetReady}
	<Page class="pb-safe-24">
		<Navbar title="Cards" />
		<div class="flex justify-center p-8"><Preloader /></div>
	</Page>
{:else if blocked}
	<Page class="pb-safe-24">
		<Navbar title="Cards" />
		<div class="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
			<p>esse usuario tem o modo de privacidade ativo e não é possível ver os cards dele. 🔒</p>
		</div>
	</Page>
{:else if detailSection}
	<SubcategoryDetailView
		subcategoryId={detailSection.subcategoryId}
		subcategoryName={detailSection.subcategoryName}
		{onBack}
		onOpenActions={(c) => (actionsCard = c)}
	/>
{:else}
	<Page class="pb-safe-24">
		<Navbar title={readOnly ? `Cards de ${targetInfo?.displayName}` : 'Cards'}>
			{#snippet right()}
				{#if viewMode === 'cards' && !readOnly}
					<Link onClick={toggleSelectionMode}>{selectionMode ? 'Cancelar' : 'Selecionar'}</Link>
				{/if}
			{/snippet}
			{#snippet subnavbar()}
				{#if viewMode === 'cards'}
					<Searchbar value={searchQuery} onInput={(e: Event) => (searchQuery = (e.target as HTMLInputElement).value)} onClear={() => (searchQuery = '')} placeholder="Pesquisar..." />
				{:else if !readOnly}
					<Searchbar value={wishlistQuery} onInput={(e: Event) => (wishlistQuery = (e.target as HTMLInputElement).value)} onClear={() => (wishlistQuery = '')} placeholder="Pesquisar qualquer card..." />
				{/if}
			{/snippet}
		</Navbar>

		<div class="p-4 pb-0">
			<Segmented strong>
				<SegmentedButton strong active={viewMode === 'cards'} onClick={() => (viewMode = 'cards')}>Cards</SegmentedButton>
				<SegmentedButton strong active={viewMode === 'wishlist'} onClick={() => (viewMode = 'wishlist')}>Lista de desejos</SegmentedButton>
			</Segmented>
		</div>

		{#if viewMode === 'cards'}
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
						selectionMode={selectionMode && !readOnly}
						{selectedIds}
						{quantities}
						onToggleSelect={toggleSelect}
						onQuantityChange={setQuantity}
						onOpenActions={(c) => (actionsCard = c)}
					/>
				{/each}
				<InfiniteScrollSentinel disabled={sections.items.length >= sections.total} loading={sections.loading} onIntersect={sections.loadMore} />
			{/if}
		{:else if browsingWishlist}
			{#if wishlist.resetLoading}
				<div class="flex justify-center p-8"><Preloader /></div>
			{:else}
				<WishlistGrid bind:items={wishlist.items} reorderable={!readOnly} onOpen={(c) => (wishlistActionsCard = c)} onReorder={onWishlistReorder} />
				<InfiniteScrollSentinel disabled={wishlist.items.length >= wishlist.total} loading={wishlist.loading} onIntersect={wishlist.loadMore} />
			{/if}
		{:else if catalogSearch.resetLoading}
			<div class="flex justify-center p-8"><Preloader /></div>
		{:else}
			<WishlistGrid bind:items={catalogSearch.items} reorderable={false} onOpen={(c) => (wishlistActionsCard = c)} onReorder={() => {}} />
			<InfiniteScrollSentinel disabled={catalogSearch.items.length >= catalogSearch.total} loading={catalogSearch.loading} onIntersect={catalogSearch.loadMore} />
		{/if}
	</Page>
{/if}

<CardActionsSheet card={actionsCard} {readOnly} onClose={() => (actionsCard = undefined)} onDiscarded={onSingleDiscarded} />
{#if !readOnly}
	<WishlistActionsSheet card={wishlistActionsCard} onClose={() => (wishlistActionsCard = undefined)} onChanged={onWishlistCardChanged} />
{/if}

{#if !readOnly && selectionMode && selectedCards.length > 0}
	<BulkDiscardBar selectedCards={selectedCards} {quantities} onDone={onBulkDone} />
{/if}
