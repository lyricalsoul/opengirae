<script lang="ts">
	import './app.css';
	import { init, retrieveRawInitData } from '@tma.js/sdk-svelte';
	import { App, Page as KonstaPage } from 'konsta/svelte';

	let { children } = $props();

	type GateState = 'loading' | 'ready' | 'no-init-data';
	let gateState = $state<GateState>('loading');

	$effect(() => {
		try {
			init();
		} catch {
		}
		gateState = retrieveRawInitData() ? 'ready' : 'no-init-data';
	});
</script>

<App theme="ios">
	{#if gateState === 'loading'}
		<KonstaPage>
			<div class="flex h-full items-center justify-center">Carregando...</div>
		</KonstaPage>
	{:else if gateState === 'no-init-data'}
		<KonstaPage>
			<div class="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
				<p>Esse app só funciona dentro do Telegram.</p>
				<a href="https://t.me/giraebot" class="text-blue-500">Abrir no Telegram</a>
			</div>
		</KonstaPage>
	{:else}
		{@render children()}
	{/if}
</App>
