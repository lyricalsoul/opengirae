<script lang="ts">
	import { List, Checkbox, Stepper } from 'konsta/svelte';
	import { scale, slide } from 'svelte/transition';

	type Card = { id: number; name: string; imageUrl: string | null; rarityName: string; rarityEmoji: string; ownedCount: number };

	let {
		cards,
		selectionMode = false,
		selectedIds,
		quantities,
		onToggleSelect,
		onQuantityChange,
		onOpenActions,
	}: {
		cards: Card[];
		selectionMode?: boolean;
		selectedIds?: Set<number>;
		quantities?: Record<number, number>;
		onToggleSelect?: (cardId: number) => void;
		onQuantityChange?: (cardId: number, quantity: number) => void;
		onOpenActions?: (card: Card) => void;
	} = $props();

	const clickable = $derived(selectionMode ? !!onToggleSelect : !!onOpenActions);

	function handleClick(card: Card) {
		if (selectionMode) onToggleSelect?.(card.id);
		else onOpenActions?.(card);
	}

	function quantityOf(cardId: number) {
		return quantities?.[cardId] ?? 1;
	}
</script>

<List strong outline>
	{#each cards as card (card.id)}
		<li class="hairline-b last:hairline-b-none relative overflow-hidden">
			<button
				type="button"
				onclick={() => handleClick(card)}
				disabled={!clickable}
				class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 active:scale-[0.99] active:duration-0 disabled:pointer-events-none {selectedIds?.has(card.id) ? 'bg-primary/10' : ''}"
			>
				{#if selectionMode}
					<!-- display-only: own onChange here double-fires with the row button's onclick -->
					<div transition:scale={{ duration: 150, start: 0.5 }} class="pointer-events-none">
						<Checkbox checked={selectedIds?.has(card.id) ?? false} />
					</div>
				{/if}
				{#if card.imageUrl}
					<div class="aspect-3/4 w-12 shrink-0 rounded-lg bg-cover bg-center" style={`background-image: url(${card.imageUrl})`}></div>
				{:else}
					<div class="aspect-3/4 w-12 shrink-0 rounded-lg bg-black/10 dark:bg-white/10"></div>
				{/if}
				<div class="ml-1 min-w-0 flex-1">
					<div class="truncate font-semibold text-black dark:text-white">{card.name}</div>
					<div class="truncate text-sm text-black/55 dark:text-white/55">{card.rarityEmoji} {card.rarityName}</div>
				</div>
				{#if card.ownedCount > 1}
					<div class="shrink-0 text-sm text-black/55 dark:text-white/55">x{card.ownedCount}</div>
				{/if}
			</button>
			{#if selectionMode && selectedIds?.has(card.id) && card.ownedCount > 1}
				<div transition:slide={{ duration: 200 }} class="flex items-center justify-between gap-3 border-t border-black/5 px-4 py-2 dark:border-white/10">
					<span class="text-sm text-black/55 dark:text-white/55">Quantidade a descartar</span>
					<Stepper
						small
						value={quantityOf(card.id)}
						onMinus={() => onQuantityChange?.(card.id, Math.max(1, quantityOf(card.id) - 1))}
						onPlus={() => onQuantityChange?.(card.id, Math.min(card.ownedCount, quantityOf(card.id) + 1))}
					/>
				</div>
			{/if}
		</li>
	{/each}
</List>
