<script lang="ts">
	import type { ChartConfiguration } from 'chart.js';
	import Chart from '$lib/components/Chart.svelte';

	let { data } = $props();
	// svelte-ignore state_referenced_locally -- no reactive updates needed
	const { stats } = data;

	const backgroundsCount = stats.itemsByType.find((i) => i.type === 'background')?.total ?? 0;
	const stickersCount = stats.itemsByType.find((i) => i.type === 'sticker')?.total ?? 0;

	const tiles = [
		{ label: 'Usuários', value: stats.users.total },
		{ label: 'Banidos', value: stats.users.banned },
		{ label: 'Admins', value: stats.users.admins },
		{ label: 'Moedas em circulação', value: stats.coinsInCirculation },
		{ label: 'Cartas no catálogo', value: stats.cardCount },
		{ label: 'Giros realizados', value: stats.drawCount },
		{ label: 'Itens comprados', value: stats.purchaseCount },
		{ label: 'Trocas realizadas', value: stats.tradeCount },
		{ label: 'Fundos', value: backgroundsCount },
		{ label: 'Figurinhas', value: stickersCount }
	];

	const ink = '#f4ece8';
	const inkDim = '#b6a7c2';
	const line = '#35293f';
	const cyan = '#33e6da';
	const yellow = '#ffc530';

	const drawsConfig: ChartConfiguration = {
		type: 'bar',
		data: {
			labels: stats.drawsByDay.map((d) => d.day),
			datasets: [
				{
					data: stats.drawsByDay.map((d) => d.total),
					backgroundColor: cyan,
					borderRadius: 4,
					maxBarThickness: 28
				}
			]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: {
				x: { grid: { display: false }, ticks: { color: inkDim, font: { size: 11 } } },
				y: { grid: { color: line }, ticks: { color: inkDim, font: { size: 11 } }, beginAtZero: true }
			}
		}
	};

	const rarityConfig: ChartConfiguration = {
		type: 'bar',
		data: {
			labels: stats.cardsByRarity.map((r) => r.rarity),
			datasets: [
				{
					data: stats.cardsByRarity.map((r) => r.total),
					backgroundColor: yellow,
					borderRadius: 4,
					maxBarThickness: 22
				}
			]
		},
		options: {
			indexAxis: 'y',
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: {
				x: { grid: { color: line }, ticks: { color: inkDim, font: { size: 11 } }, beginAtZero: true },
				y: { grid: { display: false }, ticks: { color: ink, font: { size: 12 } } }
			}
		}
	};

	const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
	function relativeTime(date: Date) {
		const diffMs = new Date(date).getTime() - Date.now();
		const diffMin = Math.round(diffMs / 60000);
		if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
		const diffHour = Math.round(diffMin / 60);
		if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hour');
		return rtf.format(Math.round(diffHour / 24), 'day');
	}
</script>

<h1 class="text-ink mb-6 text-2xl font-bold">Visão geral</h1>

<div class="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
	{#each tiles as tile (tile.label)}
		<div class="border-line bg-panel rounded-xl border p-4">
			<p class="text-ink text-2xl font-bold">{tile.value.toLocaleString('pt-BR')}</p>
			<p class="text-ink-dim mt-1 text-xs">{tile.label}</p>
		</div>
	{/each}
</div>

<div class="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
	<div class="border-line bg-panel rounded-xl border p-4">
		<p class="text-ink mb-4 text-sm font-semibold">Giros nos últimos 14 dias</p>
		<div style="height: 220px;">
			<Chart config={drawsConfig} />
		</div>
	</div>

	<div class="border-line bg-panel rounded-xl border p-4">
		<p class="text-ink mb-4 text-sm font-semibold">Cartas por raridade</p>
		<div style="height: 220px;">
			<Chart config={rarityConfig} />
		</div>
	</div>
</div>

{#snippet leaderboardRow(id: number, displayName: string, avatarUrl: string, valueLabel: string)}
	<li class="flex items-center gap-3 text-sm">
		<img src={avatarUrl} alt="" class="border-line h-8 w-8 shrink-0 rounded-full border object-cover" />
		<span class="text-ink min-w-0 flex-1 truncate">
			<span class="text-ink-dim">{id}.</span>
			{displayName}
		</span>
		<span class="text-ink-dim shrink-0 text-xs">{valueLabel}</span>
	</li>
{/snippet}

<div class="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
	<div class="border-line bg-panel rounded-xl border p-4">
		<p class="text-ink mb-4 text-sm font-semibold">Usuários mais ricos</p>
		{#if stats.richestUsers.length === 0}
			<p class="text-ink-dim text-sm">Nenhum usuário registrado.</p>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each stats.richestUsers as u (u.id)}
					{@render leaderboardRow(u.id, u.displayName, u.avatarUrl, `${u.coins.toLocaleString('pt-BR')} moedas`)}
				{/each}
			</ul>
		{/if}
	</div>

	<div class="border-line bg-panel rounded-xl border p-4">
		<p class="text-ink mb-4 text-sm font-semibold">Mais cartas</p>
		{#if stats.mostCardsUsers.length === 0}
			<p class="text-ink-dim text-sm">Nenhum usuário registrado.</p>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each stats.mostCardsUsers as u (u.id)}
					{@render leaderboardRow(u.id, u.displayName, u.avatarUrl, `${u.total.toLocaleString('pt-BR')} cartas`)}
				{/each}
			</ul>
		{/if}
	</div>
</div>

<div class="border-line bg-panel rounded-xl border p-4">
	<p class="text-ink mb-4 text-sm font-semibold">Atividade recente</p>
	{#if stats.recentActivity.length === 0}
		<p class="text-ink-dim text-sm">Nenhuma atividade registrada.</p>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each stats.recentActivity as entry (entry.id)}
				<li class="flex items-center justify-between gap-3 text-sm">
					<span class="text-ink">
						<span class="text-ink-dim">{entry.actorName ?? 'sistema'}</span>
						· {entry.action}
					</span>
					<span class="text-ink-dim shrink-0 text-xs">{relativeTime(entry.createdAt)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
