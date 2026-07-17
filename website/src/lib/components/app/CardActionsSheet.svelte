<script lang="ts">
	import { Actions, ActionsGroup, ActionsButton, ActionsLabel } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { CARD_DISCARD_REWARDS } from '@girae/database/constants';
	import DiscardConfirmDialog from './DiscardConfirmDialog.svelte';

	type Card = { id: number; name: string; imageUrl: string | null; rarityEmoji: string; rarityName: string };

	let {
		card,
		onClose,
		onDiscarded,
	}: {
		card: Card | undefined;
		onClose: () => void;
		onDiscarded: (cardId: number, coinsAwarded: number) => void;
	} = $props();

	let confirmOpen = $state(false);
	let discarding = $state(false);
	let favoriteCardId = $state<number | null>(null);
	let settingFavorite = $state(false);

	$effect(() => {
		if (card) telegramTrpc.telegram.cards.myFavoriteCardId.query().then((id) => (favoriteCardId = id));
	});

	async function copyId() {
		if (!card) return;
		await navigator.clipboard.writeText(String(card.id));
		onClose();
	}

	async function setFavorite() {
		if (!card || card.id === favoriteCardId || settingFavorite) return;
		settingFavorite = true;
		await telegramTrpc.telegram.cards.setFavorite.mutate({ cardId: card.id });
		settingFavorite = false;
		onClose();
	}

	async function discard() {
		if (!card) return;
		const cardId = card.id;
		discarding = true;
		const result = await telegramTrpc.telegram.cards.discard.mutate({ cardId });
		discarding = false;
		confirmOpen = false;
		onClose();
		if (result) onDiscarded(cardId, result.coinsAwarded);
	}
</script>

<Actions opened={!!card} onBackdropClick={onClose}>
	<ActionsGroup>
		<ActionsLabel class="h-30 w-full">
			{#if card}
				<div class="flex flex-col items-center justify-center gap-2 h-full w-full">
					{#if card.imageUrl}
						<div class="ios:rounded-lg material:rounded aspect-[3/4] w-15 bg-cover bg-center" style={`background-image: url(${card.imageUrl})`}></div>
					{/if}
					<span>{card.rarityEmoji} {card.name}</span>
				</div>
			{/if}
		</ActionsLabel>
		<ActionsButton onClick={copyId}>Copiar ID do card</ActionsButton>
		<ActionsButton onClick={setFavorite}>
			{card && card.id === favoriteCardId ? 'Carta favorita atual' : 'Marcar como favorita'}
		</ActionsButton>
		<ActionsButton onClick={() => (confirmOpen = true)}>Deletar card</ActionsButton>
	</ActionsGroup>
	<ActionsGroup>
		<ActionsButton onClick={onClose}>Cancelar</ActionsButton>
	</ActionsGroup>
</Actions>

<DiscardConfirmDialog
	opened={confirmOpen}
	coinsEstimate={card ? (CARD_DISCARD_REWARDS[card.rarityName] ?? 0) : 0}
	confirming={discarding}
	onConfirm={discard}
	onCancel={() => (confirmOpen = false)}
/>
