<script lang="ts">
	import { toasts } from '$lib/stores/toast.svelte';
</script>

<div class="fixed right-4 bottom-4 z-100 flex flex-col gap-2">
	{#each toasts as t (t.id)}
		<div
			class="border-line rounded-lg border px-4 py-2.5 text-sm shadow-lg"
			class:bg-panel={t.type === 'success'}
			class:text-ink={t.type === 'success'}
			class:bg-magenta={t.type === 'error'}
			class:text-bg={t.type === 'error'}
		>
			{t.message}
		</div>
	{/each}
</div>
