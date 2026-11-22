<script lang="ts">
	import { Page, Navbar, Searchbar, Segmented, SegmentedButton, BlockTitle, Link, Preloader, Chip, Card, Block, Button, Dialog, DialogButton } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import StoreItemCard from './StoreItemCard.svelte';
	import StoreItemDetailView from './StoreItemDetailView.svelte';
	import StorefrontCardDetailView from './StorefrontCardDetailView.svelte';
	import LoadError from './LoadError.svelte';
	import InfiniteScrollSentinel from './InfiniteScrollSentinel.svelte';

	type Item = { id: number; title: string; description: string; price: number; itemURL: string; type: 'background' | 'sticker' };
	type Section = 'popular' | 'recent' | 'cheapest';

	const PAGE_SIZE = 20;

	let type = $state<'background' | 'sticker'>('background');
	let mode = $state<'store' | 'cards'>('store');

	type GiroTier = { tierIndex: number; exhausted: boolean; giros: number | null; price: number | null; resetsAt: string };
	let giroTier = $state<GiroTier | null>(null);
	let giroLoading = $state(false);
	let giroPurchasing = $state(false);
	let giroError = $state<string | null>(null);
	let giroConfirming = $state(false);

	type StorefrontCard = { id: number; name: string; imageUrl: string | null; rarityName: string; rarityEmoji: string; subcategoryName: string | null; subcategoryEmoji: string | null; price: number; alreadyBought: boolean };
	let storefrontCards = $state<StorefrontCard[]>([]);
	let storefrontResetsAt = $state<string | null>(null);
	let storefrontLoading = $state(false);
	let selectedStorefrontCard = $state<StorefrontCard | undefined>(undefined);

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

	async function loadGiroTier() {
		giroLoading = true;
		try {
			giroTier = await telegramTrpc.telegram.store.giroTier.query();
		} catch {
			giroError = 'Não deu pra carregar os pacotes de giros.';
		} finally {
			giroLoading = false;
		}
	}

	async function buyGiro() {
		giroConfirming = false;
		giroPurchasing = true;
		giroError = null;
		try {
			const result = await telegramTrpc.telegram.store.buyGiroTier.mutate();
			if (!result.ok) {
				if (result.reason === 'insufficient_funds') {
					giroError = 'Moedas insuficientes.';
				} else {
					await loadGiroTier(); // exhausted/race - re-fetch so the panel shows the real current state
				}
				return;
			}
			await loadGiroTier();
			balance = await telegramTrpc.telegram.store.balance.query();
		} catch {
			giroError = 'Não deu pra concluir a compra. Confere o seu saldo antes de tentar de novo.';
		} finally {
			giroPurchasing = false;
		}
	}

	// separate from storefrontCards.length: an empty storefront is a valid answer, and keying the effect below off "no cards yet" refetched it forever
	let storefrontLoaded = $state(false);
	let storefrontFailed = $state(false);

	async function loadStorefront() {
		storefrontLoading = true;
		storefrontFailed = false;
		try {
			const result = await telegramTrpc.telegram.storefront.list.query();
			storefrontCards = result.cards;
			storefrontResetsAt = result.resetsAt;
			storefrontLoaded = true;
		} catch {
			storefrontFailed = true;
		} finally {
			storefrontLoading = false;
		}
	}

	function formatResetIn(resetsAt: string): string {
		const diffMs = new Date(resetsAt).getTime() - Date.now();
		const hours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
		const minutes = Math.max(0, Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)));
		return `${hours}h ${minutes}min`;
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

	$effect(() => {
		if (mode === 'cards' && !giroTier) loadGiroTier();
	});

	$effect(() => {
		if (mode === 'cards' && !storefrontLoaded && !storefrontFailed && !storefrontLoading) loadStorefront();
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
			<SegmentedButton strong active={mode === 'store' && type === 'background'} onClick={() => { mode = 'store'; type = 'background'; }}>Backgrounds</SegmentedButton>
			<SegmentedButton strong active={mode === 'store' && type === 'sticker'} onClick={() => { mode = 'store'; type = 'sticker'; }}>Stickers</SegmentedButton>
			<SegmentedButton strong active={mode === 'cards'} onClick={() => (mode = 'cards')}>Cards</SegmentedButton>
		</Segmented>
	</div>

	{#if mode === 'cards'}
		<BlockTitle>Comprar giros</BlockTitle>
		{#if giroLoading && !giroTier}
			<div class="flex justify-center p-8"><Preloader /></div>
		{:else if giroTier}
			<Block>
				<Card outline class="m-0!">
					{#if giroTier.exhausted}
						<div class="text-black dark:text-white">
							Você já comprou todos os pacotes de hoje. Volte às {new Date(giroTier.resetsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
						</div>
					{:else}
						<div class="font-bold text-black dark:text-white">{giroTier.giros} giros</div>
						<div class="mt-1 text-sm text-black/55 dark:text-white/55">{(giroTier.price ?? 0).toLocaleString('en-US')} moedas</div>
						{#if giroError}<p class="mt-2 text-red-500">{giroError}</p>{/if}
						<Button rounded class="mt-4" disabled={giroPurchasing || balance < (giroTier.price ?? 0)} onClick={() => (giroConfirming = true)}>
							{#if giroPurchasing}
								<Preloader colors={{ iconIos: 'text-white', iconMaterial: 'text-white' }} class="h-4 w-4" />
							{:else}
								Comprar
							{/if}
						</Button>
					{/if}
				</Card>
			</Block>
		{:else}
			<LoadError message={giroError ?? undefined} onRetry={loadGiroTier} />
		{/if}

		<BlockTitle>
			Lendárias
			{#if storefrontResetsAt}
				<span class="text-sm font-normal text-black/55 dark:text-white/55">
					Opções resetam em {formatResetIn(storefrontResetsAt)}
				</span>
			{/if}
		</BlockTitle>
		{#if storefrontLoading && !storefrontLoaded}
			<div class="flex justify-center p-8"><Preloader /></div>
		{:else if storefrontFailed}
			<LoadError onRetry={loadStorefront} />
		{:else if storefrontCards.length === 0}
			<div class="p-8 text-center text-black/55 dark:text-white/55">Nenhuma lendária na vitrine agora.</div>
		{:else}
			<div class="grid grid-cols-3 gap-2 p-4">
				{#each storefrontCards as card (card.id)}
					<button
						type="button"
						onclick={() => (selectedStorefrontCard = card)}
						class="ios:rounded-2xl material:rounded-xl relative aspect-[3/4] overflow-hidden border-2 border-transparent bg-black/5 dark:bg-white/5"
						class:opacity-40={card.alreadyBought}
					>
						{#if card.imageUrl}
							<img src={card.imageUrl} alt={card.name} loading="lazy" class="absolute inset-0 h-full w-full object-cover" />
						{/if}
						{#if card.alreadyBought}
							<div class="absolute inset-x-0 bottom-0 bg-black/60 p-1 text-center text-xs text-white">Comprado</div>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	{:else if searchQuery}
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

<StorefrontCardDetailView
	card={selectedStorefrontCard}
	{balance}
	onBack={() => (selectedStorefrontCard = undefined)}
	onChanged={loadStorefront}
/>

<Dialog opened={giroConfirming} onBackdropClick={() => (giroConfirming = false)}>
	{#snippet title()}Confirmar compra{/snippet}
	{#if giroTier && !giroTier.exhausted}
		Comprar {giroTier.giros} giros por {(giroTier.price ?? 0).toLocaleString('en-US')} moedas?
	{/if}
	{#snippet buttons()}
		<DialogButton onClick={() => (giroConfirming = false)}>Cancelar</DialogButton>
		<DialogButton strong onClick={buyGiro}>Confirmar</DialogButton>
	{/snippet}
</Dialog>
