<script lang="ts">
	import { Actions, ActionsGroup, ActionsButton, ActionsLabel } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import DiscardConfirmDialog from './DiscardConfirmDialog.svelte';

	type Card = { id: number; name: string; imageUrl: string | null; rarityEmoji: string; rarityName: string; ownedCount: number };

	let {
		card,
		readOnly = false,
		onClose,
		onDiscarded,
	}: {
		card: Card | undefined;
		readOnly?: boolean;
		onClose: () => void;
		onDiscarded: (cardId: number, coinsAwarded: number, remainingCount: number) => void;
	} = $props();

	let confirmOpen = $state(false);
	let discarding = $state(false);
	let favoriteCardId = $state<number | null>(null);
	let onWishlist = $state(false);
	let tradable = $state(false);

	let owned = $derived(!!card && card.ownedCount > 0);

	$effect(() => {
		if (card && !readOnly) {
			telegramTrpc.telegram.cards.myFavoriteCardId.query().then((id) => (favoriteCardId = id));
			telegramTrpc.telegram.cards.wishlistStatus.query({ cardId: card.id }).then((status) => (onWishlist = status));
			if (card.ownedCount > 0) telegramTrpc.telegram.cards.tradableStatus.query({ cardId: card.id }).then((status) => (tradable = status));
		}
	});

	async function copyId() {
		if (!card) return;
		await navigator.clipboard.writeText(String(card.id));
		onClose();
	}

	function setFavorite() {
		if (!card || card.id === favoriteCardId) return;
		const cardId = card.id;
		onClose();
		telegramTrpc.telegram.cards.setFavorite.mutate({ cardId });
	}

	function toggleWishlist() {
		if (!card) return;
		const cardId = card.id;
		const next = !onWishlist;
		onClose();
		if (next) telegramTrpc.telegram.cards.wishlistAdd.mutate({ cardId });
		else telegramTrpc.telegram.cards.wishlistRemove.mutate({ cardId });
	}

	function toggleTradable() {
		if (!card) return;
		const cardId = card.id;
		const next = !tradable;
		onClose();
		telegramTrpc.telegram.cards.setTradable.mutate({ cardId, tradable: next });
	}

	async function discard(selections: { cardId: number; quantity: number }[]) {
		const selection = selections[0];
		if (!selection) return;
		discarding = true;
		const result = await telegramTrpc.telegram.cards.discard.mutate({ cardId: selection.cardId, quantity: selection.quantity });
		discarding = false;
		confirmOpen = false;
		onClose();
		if (result) onDiscarded(selection.cardId, result.coinsAwarded, result.remainingCount);
	}
</script>

<Actions opened={!!card} onBackdropClick={onClose}>
	<ActionsGroup>
		<ActionsLabel class="h-30 w-full">
			{#if card}
				<div class="flex flex-col items-center justify-center gap-2 h-full w-full">
					{#if card.imageUrl}
						<img src={card.imageUrl} alt={card.name} class="ios:rounded-lg material:rounded aspect-[3/4] w-15 object-cover" />
					{/if}
					<span>{card.rarityEmoji} {card.name}</span>
				</div>
			{/if}
		</ActionsLabel>
		<ActionsButton onClick={copyId}>Copiar ID do card</ActionsButton>
		{#if !readOnly}
			<ActionsButton onClick={toggleWishlist}>
				{onWishlist ? 'Remover da lista de desejos' : 'Adicionar à lista de desejos'}
			</ActionsButton>
			{#if owned}
				<ActionsButton onClick={setFavorite}>
					{card && card.id === favoriteCardId ? 'Carta favorita atual' : 'Marcar como favorita'}
				</ActionsButton>
				<ActionsButton onClick={toggleTradable}>
					{tradable ? 'Marcar como não trocável' : 'Marcar como trocável'}
				</ActionsButton>
				<ActionsButton onClick={() => (confirmOpen = true)} colors={{ textIos: 'text-red-500', textMaterial: 'text-red-500' }}>Deletar card</ActionsButton>
			{/if}
		{/if}
	</ActionsGroup>
	<ActionsGroup>
		<ActionsButton onClick={onClose}>Cancelar</ActionsButton>
	</ActionsGroup>
</Actions>

<DiscardConfirmDialog
	opened={confirmOpen}
	cards={card ? [card] : []}
	confirming={discarding}
	onConfirm={discard}
	onCancel={() => (confirmOpen = false)}
/>
