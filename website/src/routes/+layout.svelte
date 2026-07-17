<script lang="ts">
	import favicon from '$lib/assets/favicon.png';
	import { installDevConsoleForward } from '$lib/devConsoleForward';

	let { children } = $props();

	installDevConsoleForward();
</script>

<svelte:head>
	<link rel="icon" type="image/png" href={favicon} />
</svelte:head>

{@render children()}
