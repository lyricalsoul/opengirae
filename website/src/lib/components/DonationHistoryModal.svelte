<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';
	import { trpc } from '$lib/trpc/client';

	// createdAt/revertedAt arrive as ISO strings over the wire, despite AuditDB's Date type.
	type HistoryRow = {
		id: number;
		action: string;
		createdAt: string;
		direction: 'sent' | 'received';
		donorUserId: number;
		donorName: string | null;
		recipientUserId: number;
		recipientName: string | null;
		subcategoryName?: string | null;
		cards: { id: number; name: string; rarityEmoji: string; count: number }[];
		revertedAt: string | null;
		revertedByAdminName: string | null;
	};

	let {
		open = $bindable(false),
		userId,
		userName
	}: { open?: boolean; userId: number | null; userName: string } = $props();

	const pageSize = 20;
	let rows = $state<HistoryRow[]>([]);
	let total = $state(0);
	let offset = $state(0);
	let loading = $state(false);

	async function load() {
		if (userId === null) return;
		loading = true;
		try {
			const result = await trpc().users.donationHistory.query({ userId, limit: pageSize, offset });
			rows = result.rows;
			total = result.total;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open && userId !== null) {
			offset = 0;
			load();
		}
	});

	function nextPage() {
		offset += pageSize;
		load();
	}

	function prevPage() {
		offset = Math.max(0, offset - pageSize);
		load();
	}
</script>

<Modal bind:open title="Histórico de doações — {userName}" widthClass="max-w-lg">
	{#if loading}
		<p class="text-ink-dim text-sm">Carregando…</p>
	{:else if rows.length === 0}
		<p class="text-ink-dim text-sm">Nenhuma doação registrada.</p>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each rows as row (row.id)}
				<li class="border-line rounded-xl border p-3 text-sm">
					<div class="text-ink-dim mb-1 flex items-center justify-between text-xs">
						<span>#{row.id} · {new Date(row.createdAt).toLocaleString('pt-BR')}</span>
						{#if row.direction === 'sent'}
							<span>doou para <strong class="text-ink">{row.recipientName ?? 'usuário removido'}</strong></span>
						{:else}
							<span>recebeu de <strong class="text-ink">{row.donorName ?? 'usuário removido'}</strong></span>
						{/if}
					</div>
					{#if row.action === 'card.doarclc'}
						<p class="text-ink">
							💱 Coleção inteira: <strong>{row.subcategoryName ?? 'coleção removida'}</strong>
							({row.cards.length} card{row.cards.length === 1 ? '' : 's'})
						</p>
					{:else}
						<p class="text-ink">
							💱 {row.cards
								.map((c) => `${c.rarityEmoji} ${c.name}${c.count > 1 ? ` (${c.count}x)` : ''}`)
								.join(', ') || `${row.cards.length} card(s)`}
						</p>
					{/if}

					<div class="mt-2 flex items-center justify-end">
						{#if row.revertedAt}
							<span class="text-ink-dim text-xs">
								Revertida por {row.revertedByAdminName ?? '?'} em {new Date(
									row.revertedAt
								).toLocaleString('pt-BR')}
							</span>
						{:else}
							<span class="text-ink-dim text-xs">
								Para cancelar: <code>/doacaocancelar {row.id}</code> na bot
							</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		<div class="mt-4 flex items-center justify-between text-xs">
			<button class="btn btn-ghost" disabled={offset === 0} onclick={prevPage}>Anterior</button>
			<span class="text-ink-dim">{offset + 1}–{Math.min(offset + pageSize, total)} de {total}</span>
			<button class="btn btn-ghost" disabled={offset + pageSize >= total} onclick={nextPage}>Próxima</button>
		</div>
	{/if}
</Modal>
