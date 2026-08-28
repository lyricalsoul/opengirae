<script lang="ts">
	import { trpc } from '$lib/trpc/client';
	import { toast } from '$lib/stores/toast.svelte';

	let { data } = $props();

	const STATUS_LABEL: Record<string, string> = { active: 'Ativo', sold: 'Vendido', expired: 'Expirado', cancelled: 'Cancelado' };

	let statusFilter = $state<string>('');
	let rows = $state(data.auctions.rows);
	let busyId = $state<number | null>(null);

	async function reload() {
		const result = await trpc().auctions.list.query(statusFilter ? { status: statusFilter as 'active' | 'sold' | 'expired' | 'cancelled' } : {});
		rows = result.rows;
	}

	async function forceClose(id: number) {
		busyId = id;
		try {
			const result = await trpc().auctions.forceClose.mutate({ id });
			if (!result.ok) {
				toast.error('Não foi possível fechar - já não está ativo.');
				return;
			}
			toast.success(`Leilão #${id} fechado (${STATUS_LABEL[result.auction.status]}).`);
			await reload();
		} finally {
			busyId = null;
		}
	}

	async function cancel(id: number) {
		if (!confirm(`Cancelar o leilão #${id}? O card e as moedas voltam por inteiro pros dois lados.`)) return;
		busyId = id;
		try {
			const result = await trpc().auctions.cancel.mutate({ id });
			if (!result.ok) {
				toast.error('Não foi possível cancelar - já não está ativo.');
				return;
			}
			toast.success(`Leilão #${id} cancelado.`);
			await reload();
		} finally {
			busyId = null;
		}
	}
</script>

<h1 class="text-ink mb-6 text-2xl font-bold">Leilões</h1>

<div class="mb-4 flex items-center gap-2">
	<label class="text-ink-dim text-xs" for="status-filter">Estado</label>
	<select
		id="status-filter"
		class="field"
		bind:value={statusFilter}
		onchange={reload}
	>
		<option value="">Todos</option>
		<option value="active">Ativo</option>
		<option value="sold">Vendido</option>
		<option value="expired">Expirado</option>
		<option value="cancelled">Cancelado</option>
	</select>
</div>

<div class="border-line overflow-x-auto rounded-2xl border">
	<table class="w-full text-left text-sm">
		<thead class="text-ink-dim border-line border-b">
			<tr>
				<th class="p-3">ID</th>
				<th class="p-3">Card</th>
				<th class="p-3">Vendedor</th>
				<th class="p-3">Lance atual</th>
				<th class="p-3">Teto</th>
				<th class="p-3">Estado</th>
				<th class="p-3">Termina</th>
				<th class="p-3"></th>
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.auction.id)}
				<tr class="border-line text-ink border-b last:border-0">
					<td class="p-3">{row.auction.id}</td>
					<td class="p-3">{row.rarityEmoji} {row.cardName}</td>
					<td class="p-3">{row.sellerName}</td>
					<td class="p-3">{(row.auction.currentBid ?? row.auction.startingBid).toLocaleString('en-US')}</td>
					<td class="p-3">{row.auction.capPrice.toLocaleString('en-US')}</td>
					<td class="p-3">{STATUS_LABEL[row.auction.status] ?? row.auction.status}</td>
					<td class="p-3">{new Date(row.auction.expiresAt).toLocaleString('pt-BR')}</td>
					<td class="p-3 whitespace-nowrap">
						{#if row.auction.status === 'active'}
							<button class="btn btn-ghost mr-2 text-xs" disabled={busyId === row.auction.id} onclick={() => forceClose(row.auction.id)}>Forçar fecho</button>
							<button class="btn btn-ghost text-xs text-red-500" disabled={busyId === row.auction.id} onclick={() => cancel(row.auction.id)}>Cancelar</button>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
