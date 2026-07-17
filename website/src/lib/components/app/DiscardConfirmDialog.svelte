<script lang="ts">
	import { Dialog, DialogButton, Preloader } from 'konsta/svelte';

	let {
		opened,
		coinsEstimate,
		cardCount = 1,
		confirming = false,
		onConfirm,
		onCancel,
	}: {
		opened: boolean;
		coinsEstimate: number;
		cardCount?: number;
		confirming?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

<Dialog {opened} onBackdropClick={confirming ? undefined : onCancel}>
	{#snippet title()}Deletar {cardCount > 1 ? `${cardCount} cards` : 'card'}?{/snippet}
	Você receberá {coinsEstimate} moedas. Essa ação não pode ser desfeita.
	{#snippet buttons()}
		<DialogButton disabled={confirming} onClick={onCancel}>Cancelar</DialogButton>
		<DialogButton strong disabled={confirming} onClick={onConfirm}>
			{#if confirming}<Preloader />{:else}Deletar{/if}
		</DialogButton>
	{/snippet}
</Dialog>
