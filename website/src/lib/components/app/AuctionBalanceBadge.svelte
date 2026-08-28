<script lang="ts">
	import { telegramTrpc } from '$lib/trpc/telegramClient';

	let balance = $state<number | undefined>(undefined);
	telegramTrpc.telegram.store.balance.query().then((result) => (balance = result));
</script>

{#if balance !== undefined}<div class="p-4 text-sm whitespace-nowrap">💰 <b>{balance.toLocaleString('en-US')}</b> moedas</div>{/if}
