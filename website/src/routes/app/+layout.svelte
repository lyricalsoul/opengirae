<script lang="ts">
	import './app.css';
	import { init, retrieveRawInitData, miniApp, useSignal } from '@tma.js/sdk-svelte';
	import { App, Page as KonstaPage } from 'konsta/svelte';

	let { children } = $props();

	type GateState = 'loading' | 'ready' | 'no-init-data';
	let gateState = $state<GateState>('loading');
	
	let isDark = $state(typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

	$effect(() => {
		try {
			init();
		} catch (e) {
			console.log('[theme] init() failed', e);
		}
		gateState = retrieveRawInitData() ? 'ready' : 'no-init-data';

		try {
			miniApp.mount();
			const darkSignal = useSignal(miniApp.isDark);
			return darkSignal.subscribe((value) => {
				isDark = value;
			});
		} catch (e) {
			console.log('[theme] miniApp.mount() failed', e);
		}
	});

	$effect(() => {
		document.documentElement.classList.toggle('dark', isDark);
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
