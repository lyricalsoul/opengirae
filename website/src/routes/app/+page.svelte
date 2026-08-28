<script lang="ts">
	import { page } from '$app/state';
	import { Tabbar, TabbarLink, ToolbarPane, Icon } from 'konsta/svelte';
	import { RectangleStackFill, BookFill, BagFill, PersonFill, HammerFill } from 'framework7-icons/svelte';
	import CardsTab from '$lib/components/app/CardsTab.svelte';
	import ColecoesTab from '$lib/components/app/ColecoesTab.svelte';
	import LojaTab from '$lib/components/app/LojaTab.svelte';
	import InventarioTab from '$lib/components/app/InventarioTab.svelte';
	import LeilaoTab from '$lib/components/app/LeilaoTab.svelte';

	type Tab = 'cards' | 'card' | 'colecoes' | 'loja' | 'leilao' | 'inventario';
	const TABS: Tab[] = ['cards', 'colecoes', 'loja', 'leilao', 'inventario'];

	const requestedTab = page.url.searchParams.get('tab');
	const initialTab = TABS.includes(requestedTab as Tab) ? (requestedTab as Tab) : 'cards';

	let activeTab = $state<Tab>(initialTab);

	let idParam = $derived(page.url.searchParams.get('id'));
	let viewingUserId = $derived(idParam && /^\d+$/.test(idParam) ? parseInt(idParam, 10) : undefined);
	// the /leilao bot command's mini app link reuses the same startapp -> ?id param plumbing,
	// but for the "leilao" tab it means "open this auction", not "view this user's cards".
	let initialAuctionId = $derived(idParam && /^\d+$/.test(idParam) ? parseInt(idParam, 10) : undefined);
</script>

{#if activeTab === 'cards' || activeTab === 'card'}
	<CardsTab {viewingUserId} />
{:else if activeTab === 'colecoes'}
	<ColecoesTab />
{:else if activeTab === 'loja'}
	<LojaTab />
{:else if activeTab === 'leilao'}
	<LeilaoTab {initialAuctionId} />
{:else}
	<InventarioTab />
{/if}

<Tabbar labels icons class="left-0 bottom-0 fixed">
	<ToolbarPane>
		<TabbarLink active={activeTab === 'cards'} onclick={() => (activeTab = 'cards')} label="Cards">
			{#snippet icon()}
				<Icon>
					{#snippet ios()}
						<RectangleStackFill class="w-6 h-6" />
					{/snippet}
				</Icon>
			{/snippet}
		</TabbarLink>
		<TabbarLink active={activeTab === 'colecoes'} onclick={() => (activeTab = 'colecoes')} label="Coleções">
			{#snippet icon()}
				<Icon>
					{#snippet ios()}
						<BookFill class="w-6 h-6" />
					{/snippet}
				</Icon>
			{/snippet}
		</TabbarLink>
		<TabbarLink active={activeTab === 'loja'} onclick={() => (activeTab = 'loja')} label="Loja">
			{#snippet icon()}
				<Icon>
					{#snippet ios()}
						<BagFill class="w-6 h-6" />
					{/snippet}
				</Icon>
			{/snippet}
		</TabbarLink>
		<TabbarLink active={activeTab === 'leilao'} onclick={() => (activeTab = 'leilao')} label="Leilão">
			{#snippet icon()}
				<Icon>
					{#snippet ios()}
						<HammerFill class="w-6 h-6" />
					{/snippet}
				</Icon>
			{/snippet}
		</TabbarLink>
		<TabbarLink active={activeTab === 'inventario'} onclick={() => (activeTab = 'inventario')} label="Inventário">
			{#snippet icon()}
				<Icon>
					{#snippet ios()}
						<PersonFill class="w-7 h-7" />
					{/snippet}
				</Icon>
			{/snippet}
		</TabbarLink>
	</ToolbarPane>
</Tabbar>
