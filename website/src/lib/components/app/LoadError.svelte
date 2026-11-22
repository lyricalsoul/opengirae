<script lang="ts">
	import { Button } from 'konsta/svelte';

	let { onRetry, message = 'Não deu pra carregar. Verifica a conexão e tenta de novo.' }: { onRetry: () => void; message?: string } = $props();
</script>

<div class="flex flex-col items-center gap-4 p-8 text-center text-black/55 dark:text-white/55">
	<p>{message}</p>
	<Button rounded class="w-auto px-6" onClick={onRetry}>Tentar de novo</Button>
</div>
