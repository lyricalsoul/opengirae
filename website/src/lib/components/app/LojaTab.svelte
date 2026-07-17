<script lang="ts">
	import { Page, Navbar, Searchbar, Segmented, SegmentedButton, BlockTitle, Link, Preloader, Chip } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import StoreItemCard from './StoreItemCard.svelte';
	import StoreItemDetailView from './StoreItemDetailView.svelte';
	import InfiniteScrollSentinel from './InfiniteScrollSentinel.svelte';

	type Item = { id: number; title: string; description: string; price: number; itemURL: string; type: 'background' | 'sticker' };
	type Section = 'popular' | 'recent' | 'cheapest';

	const PAGE_SIZE = 20;

	let type = $state<'background' | 'sticker'>('background');
	let searchQuery = $state('');
	let ownedIds = $state<number[]>([]);
	let equippedIds = $state<{ background: number | null; sticker: number | null }>({ background: null, sticker: null });
	let balance = $state(0);
	let homeLoading = $state(false);
	let homeLoadedOnce = $state(false);

	let popularItems = $state<Item[]>([]);
	let recentItems = $state<Item[]>([]);
	let cheapestItems = $state<Item[]>([]);

	let expandedSection = $state<Section | null>(null);
	let expandedItems = $state<Item[]>([]);
	let expandedTotal = $state(0);
	let expandedOffset = $state(0);
	let expandedLoading = $state(false);

	let searchResults = $state<Item[]>([]);
	let searchTotal = $state(0);
	let searchOffset = $state(0);
	let searchLoading = $state(false);

	let selectedItem = $state<Item | undefined>(undefined);

	async function loadHome() {
		homeLoading = true;
		const [popular, recent, cheapest, owned, equipped, myBalance] = await Promise.all([
			telegramTrpc.telegram.store.popular.query({ type, limit: 5 }),
			telegramTrpc.telegram.store.recent.query({ type, limit: 5 }),
			telegramTrpc.telegram.store.cheapest.query({ type, limit: 5 }),
			telegramTrpc.telegram.store.ownedItemIds.query(),
			telegramTrpc.telegram.store.equippedItemIds.query(),
			telegramTrpc.telegram.store.balance.query(),
		]);
		popularItems = popular.rows as Item[];
		recentItems = recent.rows as Item[];
		cheapestItems = cheapest.rows as Item[];
		ownedIds = owned;
		equippedIds = equipped;
		balance = myBalance;
		homeLoading = false;
		homeLoadedOnce = true;
	}

	function queryForSection(section: Section) {
		return section === 'popular' ? telegramTrpc.telegram.store.popular
			: section === 'recent' ? telegramTrpc.telegram.store.recent
			: telegramTrpc.telegram.store.cheapest;
	}

	function sectionTitle(section: Section) {
		return section === 'popular' ? 'Mais comprados' : section === 'recent' ? 'Recentemente adicionados' : 'Mais baratos';
	}

	async function loadExpanded(section: Section, reset: boolean) {
		expandedLoading = true;
		const nextOffset = reset ? 0 : expandedOffset;
		const result = await queryForSection(section).query({ type, limit: PAGE_SIZE, offset: nextOffset });
		expandedItems = reset ? (result.rows as Item[]) : [...expandedItems, ...(result.rows as Item[])];
		expandedTotal = result.total;
		expandedOffset = nextOffset + result.rows.length;
		expandedLoading = false;
	}

	function openSection(section: Section) {
		expandedSection = section;
		expandedItems = [];
		expandedOffset = 0;
		loadExpanded(section, true);
	}

	async function loadSearch(reset: boolean) {
		searchLoading = true;
		const nextOffset = reset ? 0 : searchOffset;
		const result = await telegramTrpc.telegram.store.search.query({
			type, query: searchQuery, limit: PAGE_SIZE, offset: nextOffset,
		});
		searchResults = reset ? (result.rows as Item[]) : [...searchResults, ...(result.rows as Item[])];
		searchTotal = result.total;
		searchOffset = nextOffset + result.rows.length;
		searchLoading = false;
	}

	$effect(() => {
		type;
		expandedSection = null;
		loadHome();
	});

	$effect(() => {
		if (searchQuery) loadSearch(true);
	});

	function isOwned(id: number) {
		return ownedIds.includes(id);
	}

	function isEquipped(item: Item) {
		return item.type === 'background' ? equippedIds.background === item.id : equippedIds.sticker === item.id;
	}
</script>

{#if selectedItem}
	<StoreItemDetailView
		item={selectedItem}
		owned={isOwned(selectedItem.id)}
		{balance}
		onBack={() => (selectedItem = undefined)}
		onChanged={loadHome}
	/>
{:else}
<Page class="pb-safe-24">
	<Navbar title="Loja">
		{#snippet right()}
			{#if homeLoadedOnce}<div class="p-4 text-sm">💰 <b>{balance.toLocaleString('en-US')}</b> moedas</div>{/if}
		{/snippet}
		{#snippet subnavbar()}
			<Searchbar value={searchQuery} onInput={(e: Event) => (searchQuery = (e.target as HTMLInputElement).value)} placeholder="Pesquisar..." />
		{/snippet}
	</Navbar>
	<div class="p-4">
		<Segmented strong>
			<SegmentedButton strong active={type === 'background'} onClick={() => (type = 'background')}>Papéis de parede</SegmentedButton>
			<SegmentedButton strong active={type === 'sticker'} onClick={() => (type = 'sticker')}>Stickers</SegmentedButton>
		</Segmented>
	</div>

	{#if searchQuery}
		{#if searchLoading && searchResults.length === 0}
			<div class="flex justify-center p-8"><Preloader /></div>
		{:else}
			<div class="grid grid-cols-2 gap-4 p-4">
				{#each searchResults as item (item.id)}
					<StoreItemCard {item} owned={isOwned(item.id)} equipped={isEquipped(item)} onOpen={(i) => (selectedItem = i as Item)} />
				{/each}
			</div>
			<InfiniteScrollSentinel disabled={searchResults.length >= searchTotal} loading={searchLoading} onIntersect={() => loadSearch(false)} />
		{/if}
	{:else if expandedSection}
		<BlockTitle>
			<span>{sectionTitle(expandedSection)}</span>
			<Link onClick={() => (expandedSection = null)}>Voltar</Link>
		</BlockTitle>
		{#if expandedLoading && expandedItems.length === 0}
			<div class="flex justify-center p-8"><Preloader /></div>
		{:else}
			<div class="grid grid-cols-2 gap-4 p-4">
				{#each expandedItems as item (item.id)}
					<StoreItemCard {item} owned={isOwned(item.id)} equipped={isEquipped(item)} onOpen={(i) => (selectedItem = i as Item)} />
				{/each}
			</div>
			<InfiniteScrollSentinel disabled={expandedItems.length >= expandedTotal} loading={expandedLoading} onIntersect={() => loadExpanded(expandedSection!, false)} />
		{/if}
	{:else if homeLoading && !homeLoadedOnce}
		<div class="flex justify-center p-8"><Preloader /></div>
	{:else}
		<BlockTitle>
			<span>Mais comprados</span>
			<Link onClick={() => openSection('popular')}>Ver mais</Link>
		</BlockTitle>
		<div class="flex gap-4 overflow-x-auto p-4">
			{#each popularItems as item (item.id)}
				<div class="w-64 shrink-0">
					<StoreItemCard {item} owned={isOwned(item.id)} equipped={isEquipped(item)} onOpen={(i) => (selectedItem = i as Item)} />
				</div>
			{/each}
		</div>

		<BlockTitle>
			<span>Recentemente adicionados</span>
			<Link onClick={() => openSection('recent')}>Ver mais</Link>
		</BlockTitle>
		<div class="flex gap-4 overflow-x-auto p-4">
			{#each recentItems as item (item.id)}
				<div class="w-64 shrink-0">
					<StoreItemCard {item} owned={isOwned(item.id)} equipped={isEquipped(item)} onOpen={(i) => (selectedItem = i as Item)} />
				</div>
			{/each}
		</div>

		<BlockTitle>
			<span>Mais baratos</span>
			<Link onClick={() => openSection('cheapest')}>Ver mais</Link>
		</BlockTitle>
		<div class="flex gap-4 overflow-x-auto p-4">
			{#each cheapestItems as item (item.id)}
				<div class="w-64 shrink-0">
					<StoreItemCard {item} owned={isOwned(item.id)} equipped={isEquipped(item)} onOpen={(i) => (selectedItem = i as Item)} />
				</div>
			{/each}
		</div>
	{/if}
</Page>
{/if}
