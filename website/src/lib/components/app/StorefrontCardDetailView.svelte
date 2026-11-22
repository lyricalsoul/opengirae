<script lang="ts">
	import { bgImage } from '$lib/css';
	import { Sheet, BlockTitle, Block, Button, Preloader, Dialog, DialogButton } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';

	type StorefrontCard = { id: number; name: string; imageUrl: string | null; rarityName: string; rarityEmoji: string; subcategoryName: string | null; subcategoryEmoji: string | null; price: number; alreadyBought: boolean };

	let {
		card,
		balance,
		onBack,
		onChanged,
	}: {
		card: StorefrontCard | undefined;
		balance: number;
		onBack: () => void;
		onChanged: () => void;
	} = $props();

	let purchasing = $state(false);
	let purchaseError = $state<string | null>(null);
	let confirming = $state(false);

	let canAfford = $derived(!!card && balance >= card.price);

	async function buy() {
		if (!card) return;
		confirming = false;
		purchasing = true;
		purchaseError = null;
		try {
			const result = await telegramTrpc.telegram.storefront.buy.mutate({ cardId: card.id });
			if (!result.ok) {
				purchaseError = result.reason === 'insufficient_funds' ? 'Moedas insuficientes.' : 'Esse card não está mais disponível.';
				return;
			}
			onChanged();
			onBack();
		} catch {
			purchaseError = 'Não deu pra concluir a compra. Confere o seu saldo antes de tentar de novo.';
		} finally {
			purchasing = false;
		}
	}
</script>

<Sheet opened={!!card} onBackdropClick={onBack} class="ios:rounded-t-2xl material:rounded-t-xl">
	{#if card}
		<BlockTitle class="!justify-center !mb-4">Comprar card?</BlockTitle>
		<Block class="flex gap-4">
			{#if card.imageUrl}
				<div class="aspect-3/4 w-1/3 shrink-0 rounded-lg bg-cover bg-center" style={bgImage(card.imageUrl)}></div>
			{:else}
				<div class="flex aspect-3/4 w-1/3 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/10">
					<Preloader />
				</div>
			{/if}
			<div class="flex flex-1 flex-col">
				<p class="text-lg font-black text-black dark:text-white">{card.name} {card.rarityEmoji}</p>
				{#if card.subcategoryName}<p class="text-black/55 dark:text-white/55">{card.subcategoryEmoji} {card.subcategoryName}</p>{/if}

				{#if purchaseError}<p class="mt-2 text-red-500">{purchaseError}</p>{/if}

				<div class="flex-1"></div>

				{#if card.alreadyBought}
					<p class="text-black/55 dark:text-white/55">Você já comprou este card nesta rotação.</p>
				{:else}
					<Button rounded disabled={!canAfford || purchasing} onClick={() => (confirming = true)}>
						{#if purchasing}
							<Preloader colors={{ iconIos: 'text-white', iconMaterial: 'text-white' }} class="h-4 w-4" />
						{:else}
							Comprar por {card.price.toLocaleString('en-US')} moedas
						{/if}
					</Button>
				{/if}
			</div>
		</Block>
	{/if}
</Sheet>

<Dialog opened={confirming} onBackdropClick={() => (confirming = false)}>
	{#snippet title()}Confirmar compra{/snippet}
	{#if card}Comprar {card.name} por {card.price.toLocaleString('en-US')} moedas?{/if}
	{#snippet buttons()}
		<DialogButton onClick={() => (confirming = false)}>Cancelar</DialogButton>
		<DialogButton strong onClick={buy}>Confirmar</DialogButton>
	{/snippet}
</Dialog>
