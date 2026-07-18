<script lang="ts">
	import { Actions, ActionsGroup, ActionsButton, ActionsLabel } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';

	type Card = { id: number; name: string; imageUrl: string | null; rarityEmoji: string; rarityName: string };

	let {
		card,
		onClose,
		onChanged,
	}: {
		card: Card | undefined;
		onClose: () => void;
		onChanged: (card: Card, onWishlist: boolean) => void;
	} = $props();

	let onWishlist = $state(false);

	$effect(() => {
		if (card) telegramTrpc.telegram.cards.wishlistStatus.query({ cardId: card.id }).then((status) => (onWishlist = status));
	});

	function toggle() {
		if (!card) return;
		const targetCard = card;
		const next = !onWishlist;
		onClose();
		onChanged(targetCard, next);
		if (next) telegramTrpc.telegram.cards.wishlistAdd.mutate({ cardId: targetCard.id });
		else telegramTrpc.telegram.cards.wishlistRemove.mutate({ cardId: targetCard.id });
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
		<ActionsButton onClick={toggle}>
			{onWishlist ? 'Remover da lista de desejos' : 'Adicionar à lista de desejos'}
		</ActionsButton>
	</ActionsGroup>
	<ActionsGroup>
		<ActionsButton onClick={onClose}>Cancelar</ActionsButton>
	</ActionsGroup>
</Actions>
