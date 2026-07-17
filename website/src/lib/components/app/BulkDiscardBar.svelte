<script lang="ts">
	import { Toolbar, Button } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { CARD_DISCARD_REWARDS } from '@girae/database/constants';
	import DiscardConfirmDialog from './DiscardConfirmDialog.svelte';

	type Card = { id: number; name: string; rarityEmoji: string; rarityName: string; ownedCount: number };

	let {
		selectedCards,
		quantities,
		onDone,
	}: {
		selectedCards: Card[];
		quantities: Record<number, number>;
		onDone: (totalCoinsAwarded: number) => void;
	} = $props();

	let confirmOpen = $state(false);
	let discarding = $state(false);

	let estimatedTotal = $derived(
		selectedCards.reduce((sum, c) => sum + (CARD_DISCARD_REWARDS[c.rarityName] ?? 0) * (quantities[c.id] ?? 1), 0),
	);

	async function confirmDiscard(selections: { cardId: number; quantity: number }[]) {
		discarding = true;
		const cardIds = selections.flatMap((s) => Array(s.quantity).fill(s.cardId));
		const result = await telegramTrpc.telegram.cards.discardMany.mutate({ cardIds });
		discarding = false;
		confirmOpen = false;
		if (result.ok) onDone(result.totalCoinsAwarded);
		// a not-ok result (stale selection) is surfaced by the caller re-fetching the list
	}
</script>

<Toolbar class="left-0 bottom-safe-16 fixed z-20" innerClass="items-center">
	<div class="left">{selectedCards.length} selecionado{selectedCards.length === 1 ? '' : 's'} (~{estimatedTotal} moedas)</div>
	<div class="right"><Button rounded onClick={() => (confirmOpen = true)}>Descartar</Button></div>
</Toolbar>

<DiscardConfirmDialog
	opened={confirmOpen}
	cards={selectedCards}
	initialQuantities={quantities}
	confirming={discarding}
	onConfirm={confirmDiscard}
	onCancel={() => (confirmOpen = false)}
/>
