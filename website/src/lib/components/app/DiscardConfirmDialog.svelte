<script lang="ts">
	import { Dialog, DialogButton, Preloader, Stepper } from 'konsta/svelte';
	import { CARD_DISCARD_REWARDS } from '@girae/database/constants';

	type Card = { id: number; name: string; rarityEmoji: string; rarityName: string; ownedCount: number };

	let {
		opened,
		cards,
		initialQuantities,
		confirming = false,
		onConfirm,
		onCancel,
	}: {
		opened: boolean;
		cards: Card[];
		initialQuantities?: Record<number, number>;
		confirming?: boolean;
		onConfirm: (selections: { cardId: number; quantity: number }[]) => void;
		onCancel: () => void;
	} = $props();

	let quantities = $state<Record<number, number>>({});

	$effect(() => {
		if (opened) quantities = Object.fromEntries(cards.map((c) => [c.id, initialQuantities?.[c.id] ?? 1]));
	});

	function quantityOf(cardId: number) {
		return quantities[cardId] ?? 1;
	}

	function setQuantity(cardId: number, value: number) {
		quantities = { ...quantities, [cardId]: value };
	}

	let estimatedTotal = $derived(
		cards.reduce((sum, c) => sum + (CARD_DISCARD_REWARDS[c.rarityName] ?? 0) * quantityOf(c.id), 0),
	);

	function confirm() {
		onConfirm(cards.map((c) => ({ cardId: c.id, quantity: quantityOf(c.id) })));
	}
</script>

<Dialog {opened} onBackdropClick={confirming ? undefined : onCancel}>
	{#snippet title()}Deletar {cards.length > 1 ? `${cards.length} cards` : 'card'}?{/snippet}
	<div class="flex flex-col gap-3">
		{#each cards as card (card.id)}
			<div class="flex items-center justify-between gap-3">
				<span class="min-w-0 truncate text-black dark:text-white">{card.rarityEmoji} {card.name}</span>
				{#if card.ownedCount > 1}
					<Stepper
						small
						value={quantityOf(card.id)}
						onMinus={() => setQuantity(card.id, Math.max(1, quantityOf(card.id) - 1))}
						onPlus={() => setQuantity(card.id, Math.min(card.ownedCount, quantityOf(card.id) + 1))}
					/>
				{/if}
			</div>
		{/each}
	</div>
	<p class="mt-3 text-black dark:text-white">Você receberá aproximadamente {estimatedTotal} moedas. Essa ação não pode ser desfeita.</p>
	{#snippet buttons()}
		<DialogButton disabled={confirming} onClick={onCancel}>Cancelar</DialogButton>
		<DialogButton strong disabled={confirming} onClick={confirm}>
			{#if confirming}<Preloader />{:else}Deletar{/if}
		</DialogButton>
	{/snippet}
</Dialog>
