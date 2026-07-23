<script lang="ts">
	import { trpc } from '$lib/trpc/client';
	import { toast } from '$lib/stores/toast.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Pencil } from 'lucide-svelte';

	let { data } = $props();

	const formatter = new Intl.NumberFormat('pt-BR');

	// rates are stored as raw multipliers (1 = 100%) but edited/shown here as percentages
	let inflationPercent = $state(String(data.state.inflationRate * 100));
	let incomeInflationPercent = $state(String(data.state.incomeInflationRate * 100));
	let savingPrices = $state(false);
	let savingIncome = $state(false);

	let priceSimulation = $derived.by(() => {
		const percent = Number(inflationPercent);
		if (isNaN(percent)) return data.baseRates.samplePrices.map((base) => ({ base, scaled: base }));
		return data.baseRates.samplePrices.map((base) => ({ base, scaled: Math.round((base * percent) / 100) }));
	});
	let incomeSimulation = $derived.by(() => {
		const percent = Number(incomeInflationPercent);
		const rows = [
			{ label: '/daily (dia normal)', base: data.baseRates.dailyBase },
			...Object.entries(data.baseRates.cardDiscardRewards).map(([rarity, base]) => ({
				label: `Descartar carta ${rarity}`,
				base
			}))
		];
		if (isNaN(percent)) return rows.map((row) => ({ ...row, scaled: row.base }));
		return rows.map((row) => ({ ...row, scaled: Math.round((row.base * percent) / 100) }));
	});

	async function saveInflationRate() {
		const percent = Number(inflationPercent);
		if (isNaN(percent)) {
			toast.error('Valor inválido');
			return;
		}
		savingPrices = true;
		try {
			const updated = await trpc().economy.setInflationRate.mutate({ rate: percent / 100 });
			inflationPercent = String(updated.inflationRate * 100);
			toast.success('Taxa de inflação de preços atualizada');
		} catch {
			toast.error('Falha ao atualizar a taxa de inflação de preços');
		} finally {
			savingPrices = false;
		}
	}

	async function saveIncomeInflationRate() {
		const percent = Number(incomeInflationPercent);
		if (isNaN(percent)) {
			toast.error('Valor inválido');
			return;
		}
		savingIncome = true;
		try {
			const updated = await trpc().economy.setIncomeInflationRate.mutate({ rate: percent / 100 });
			incomeInflationPercent = String(updated.incomeInflationRate * 100);
			toast.success('Taxa de inflação de renda atualizada');
		} catch {
			toast.error('Falha ao atualizar a taxa de inflação de renda');
		} finally {
			savingIncome = false;
		}
	}

	// --- treasury balance edit ---

	let treasuryModalOpen = $state(false);
	let treasuryBalance = $state(data.state.treasuryBalance);
	let editingBalance = $state(String(data.state.treasuryBalance));
	let savingTreasury = $state(false);

	function openTreasuryEdit() {
		editingBalance = String(treasuryBalance);
		treasuryModalOpen = true;
	}

	async function saveTreasuryBalance(e: SubmitEvent) {
		e.preventDefault();
		const balance = Number(editingBalance);
		if (isNaN(balance)) {
			toast.error('Valor inválido');
			return;
		}
		savingTreasury = true;
		try {
			const updated = await trpc().economy.setTreasuryBalance.mutate({ balance });
			treasuryBalance = updated.treasuryBalance;
			treasuryModalOpen = false;
			toast.success('Tesouro atualizado');
		} catch {
			toast.error('Falha ao atualizar o tesouro');
		} finally {
			savingTreasury = false;
		}
	}
</script>

<h1 class="text-ink mb-6 text-2xl font-bold">Economia</h1>

<div class="border-line bg-panel mb-6 flex max-w-md items-center justify-between rounded-xl border p-5">
	<div>
		<p class="text-ink-dim text-xs">Tesouro</p>
		<p class="text-ink text-2xl font-semibold">{formatter.format(treasuryBalance)} moedas</p>
	</div>
	<button
		class="text-ink-dim hover:text-ink hover:bg-bg-soft rounded-lg p-2 transition-colors"
		aria-label="Editar tesouro"
		onclick={openTreasuryEdit}
	>
		<Pencil size={16} />
	</button>
</div>

<div class="grid max-w-3xl grid-cols-1 gap-6 md:grid-cols-2">
	<div class="border-line bg-panel rounded-xl border p-5">
		<label class="text-ink-dim text-xs" for="inflationRate">
			Inflação de preços (multiplica o preço de todos os itens da loja)
		</label>
		<div class="mt-2 flex items-center gap-2">
			<div class="relative w-24">
				<input id="inflationRate" type="text" inputmode="decimal" bind:value={inflationPercent} class="field pr-6" />
				<span class="text-ink-dim pointer-events-none absolute inset-y-0 right-3 flex items-center">%</span>
			</div>
			<button class="btn btn-default" disabled={savingPrices} onclick={saveInflationRate}>Salvar</button>
		</div>

		<table class="mt-4 w-full text-xs">
			<thead>
				<tr class="text-ink-dim text-left">
					<th class="pb-1 font-normal">Preço base</th>
					<th class="pb-1 font-normal">Com inflação</th>
				</tr>
			</thead>
			<tbody>
				{#each priceSimulation as row (row.base)}
					<tr class="border-line border-t">
						<td class="text-ink-dim py-1">{formatter.format(row.base)} moedas</td>
						<td class="text-ink py-1">{formatter.format(row.scaled)} moedas</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="border-line bg-panel rounded-xl border p-5">
		<label class="text-ink-dim text-xs" for="incomeInflationRate">
			Inflação de renda (multiplica /daily, recompensas de descarte, e as moedas de códigos promocionais)
		</label>
		<div class="mt-2 flex items-center gap-2">
			<div class="relative w-24">
				<input id="incomeInflationRate" type="text" inputmode="decimal" bind:value={incomeInflationPercent} class="field pr-6" />
				<span class="text-ink-dim pointer-events-none absolute inset-y-0 right-3 flex items-center">%</span>
			</div>
			<button class="btn btn-default" disabled={savingIncome} onclick={saveIncomeInflationRate}>Salvar</button>
		</div>

		<table class="mt-4 w-full text-xs">
			<thead>
				<tr class="text-ink-dim text-left">
					<th class="pb-1 font-normal">Recompensa</th>
					<th class="pb-1 font-normal">Base</th>
					<th class="pb-1 font-normal">Com inflação</th>
				</tr>
			</thead>
			<tbody>
				{#each incomeSimulation as row (row.label)}
					<tr class="border-line border-t">
						<td class="text-ink-dim py-1">{row.label}</td>
						<td class="text-ink-dim py-1">{formatter.format(row.base)}</td>
						<td class="text-ink py-1">{formatter.format(row.scaled)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<Modal bind:open={treasuryModalOpen} title="Editar tesouro">
	<form onsubmit={saveTreasuryBalance} class="flex flex-col gap-3">
		<label class="text-ink-dim text-xs">
			Saldo do tesouro
			<input type="text" inputmode="numeric" bind:value={editingBalance} class="field mt-1" required />
		</label>
		<div class="mt-2 flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (treasuryModalOpen = false)}>Cancelar</button>
			<button type="submit" class="btn btn-default" disabled={savingTreasury}>Salvar</button>
		</div>
	</form>
</Modal>
