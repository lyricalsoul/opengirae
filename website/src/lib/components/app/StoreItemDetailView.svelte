<script lang="ts">
	import { Page, Navbar, NavbarBackLink, Block, Button, Preloader, Dialog, DialogButton } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';

	type Item = { id: number; title: string; description: string; price: number; itemURL: string; type: 'background' | 'sticker' };

	let {
		item,
		owned,
		balance,
		onBack,
		onChanged,
	}: {
		item: Item;
		owned: boolean;
		balance: number;
		onBack: () => void;
		onChanged: () => void;
	} = $props();

	let previewUrl = $state<string | null>(null);
	let purchasing = $state(false);
	let purchaseError = $state<string | null>(null);
	let showEquipPrompt = $state(false);

	$effect(() => {
		telegramTrpc.telegram.store.preview.query({ itemId: item.id }).then((result) => {
			previewUrl = result?.url ?? item.itemURL;
		});
	});

	let canAfford = $derived(balance >= item.price);

	async function buy() {
		purchasing = true;
		purchaseError = null;
		const result = await telegramTrpc.telegram.store.buy.mutate({ itemId: item.id });
		purchasing = false;
		if (!result.ok) {
			purchaseError =
				result.reason === 'insufficient_funds' ? 'Moedas insuficientes.' :
				result.reason === 'already_owned' ? 'Você já possui este item.' :
				'Item não encontrado.';
			return;
		}
		showEquipPrompt = true;
		onChanged();
	}

	function equip() {
		showEquipPrompt = false;
		onChanged();
		onBack();
		telegramTrpc.telegram.store.equip.mutate({ itemId: item.id, type: item.type });
	}
</script>

<Page class="pb-safe-24">
	<Navbar title={item.title.length > 20 ? `${item.title.slice(0, 20)}...` : item.title}>	
		{#snippet left()}
			<NavbarBackLink onclick={onBack} />
		{/snippet}
	</Navbar>
	<Block>
		{#if previewUrl}
			<div class="mb-4 aspect-3/2 w-full rounded-lg bg-cover bg-center" style={`background-image: url(${previewUrl})`}></div>
		{:else}
			<div class="mb-4 flex aspect-3/2 w-full items-center justify-center rounded-lg bg-black/5 dark:bg-white/10">
				<Preloader />
			</div>
		{/if}
		<p class="text-black dark:text-white mb-5">{item.description}</p>

		{#if purchaseError}<p class="text-red-500">{purchaseError}</p>{/if}
		{#if !owned}
			<Button rounded disabled={!canAfford || purchasing} onClick={buy}>
				{#if purchasing}
					<Preloader colors={{ iconIos: 'text-white', iconMaterial: 'text-white' }} class="h-4 w-4" />
				{:else}
					Comprar por {item.price} moedas
				{/if}
			</Button>
		{/if}
	</Block>
</Page>

<Dialog opened={showEquipPrompt}>
	{#snippet title()}Equipar agora?{/snippet}
	Você comprou {item.title}. Quer equipar agora?
	{#snippet buttons()}
		<DialogButton onClick={() => { showEquipPrompt = false; onBack(); }}>Não</DialogButton>
		<DialogButton strong onClick={equip}>Sim</DialogButton>
	{/snippet}
</Dialog>
