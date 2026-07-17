<script lang="ts">
	import { Preloader } from 'konsta/svelte';

	let {
		onIntersect,
		disabled = false,
		loading = false,
	}: { onIntersect: () => void; disabled?: boolean; loading?: boolean } = $props();

	let sentinel: HTMLDivElement;

	$effect(() => {
		if (disabled || !sentinel) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) onIntersect();
			},
			{ rootMargin: '200px' },
		);
		observer.observe(sentinel);

		return () => observer.disconnect();
	});
</script>

<div bind:this={sentinel} class="flex h-8 w-full items-center justify-center">
	{#if !disabled && loading}<Preloader />{/if}
</div>
