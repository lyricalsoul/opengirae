<script lang="ts">
	import { trpc } from '$lib/trpc/client';
	import { toast } from '$lib/stores/toast.svelte';

	let { data } = $props();

	let enableDiscoteca = $state(data.state.enableDiscoteca);
	let auctionsEnabled = $state(data.economyState.auctionsEnabled);

	async function toggleDiscoteca() {
		const next = !enableDiscoteca;
		enableDiscoteca = next;
		try {
			await trpc().settings.setDiscotecaEnabled.mutate({ enabled: next });
			toast.success(next ? 'Discoteca ativada' : 'Discoteca desativada');
		} catch {
			enableDiscoteca = !next;
			toast.error('Falha ao atualizar a configuração');
		}
	}

	async function toggleAuctions() {
		const next = !auctionsEnabled;
		auctionsEnabled = next;
		try {
			await trpc().economy.setAuctionsEnabled.mutate({ enabled: next });
			toast.success(next ? 'Leilões ativados' : 'Leilões desativados');
		} catch {
			auctionsEnabled = !next;
			toast.error('Falha ao atualizar a configuração');
		}
	}
</script>

<h1 class="text-ink mb-6 text-2xl font-bold">Configurações</h1>

<div class="grid max-w-md grid-cols-1 gap-6">
	<div class="border-line bg-panel rounded-xl border p-5">
		<label class="text-ink flex items-center justify-between gap-4 text-sm font-medium">
			Ativar Discoteca
			<input type="checkbox" checked={enableDiscoteca} onchange={toggleDiscoteca} />
		</label>
		<p class="text-ink-dim mt-2 text-xs">
			Quando desativado, não é possível girar álbuns ou singles.
		</p>
	</div>

	<div class="border-line bg-panel rounded-xl border p-5">
		<label class="text-ink flex items-center justify-between gap-4 text-sm font-medium">
			Ativar Leilões
			<input type="checkbox" checked={auctionsEnabled} onchange={toggleAuctions} />
		</label>
		<p class="text-ink-dim mt-2 text-xs">
			Interruptor de emergência - desativar bloqueia leilões e lances novos na hora, sem precisar
			de deploy. Leilões já a decorrer continuam a fechar normalmente. A taxa de venda fica na
			página Economia.
		</p>
	</div>
</div>
