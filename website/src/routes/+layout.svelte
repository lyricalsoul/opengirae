<script lang="ts">
	import favicon from '$lib/assets/favicon.png';
	import { installDevConsoleForward } from '$lib/devConsoleForward';

	let { children } = $props();

	installDevConsoleForward();
</script>

<svelte:head>
	<link rel="icon" type="image/png" href={favicon} />
	<script defer data-domain="girae.io" src="https://plausible.lyricalsoul.io/js/script.js"></script>
</svelte:head>

{@render children()}
