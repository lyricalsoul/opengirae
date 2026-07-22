<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import {
		createGrid,
		ModuleRegistry,
		AllCommunityModule,
		themeQuartz,
		colorSchemeDark,
		type GridApi,
		type GridOptions,
		type ICellRendererParams
	} from 'ag-grid-community';
	import { trpc } from '$lib/trpc/client';
	import { toast } from '$lib/stores/toast.svelte';

	ModuleRegistry.registerModules([AllCommunityModule]);

	type PromoCodeRow = {
		id: number;
		code: string;
		rewards: Record<string, number>;
		expiresAt: string | Date;
		createdAt: string | Date;
		maxUses: number | null;
		redemptions: number;
	};

	let gridDiv: HTMLDivElement;
	let gridApi: GridApi<PromoCodeRow> | undefined;

	let rows = $state<PromoCodeRow[]>([]);
	let createDialogOpen = $state(false);
	
	let newDraws = $state<number>(0);
	let newCoins = $state<number>(0);
	let newMaxUses = $state<number | null>(null);
	let newExpiresAt = $state<string>('');

	let generatedLink = $state<string | null>(null);

	let botUsername = $state<string>('GiraeBot');

	async function loadRows() {
		try {
			const res = await trpc().promoCodes.list.query();
			rows = res.codes;
			botUsername = res.botUsername;
			gridApi?.setGridOption('rowData', rows);
		} catch {
			toast.error('Erro ao carregar códigos');
		}
	}

	function openCreateDialog() {
		newDraws = 0;
		newCoins = 0;
		newMaxUses = null;
		newExpiresAt = '';
		generatedLink = null;
		createDialogOpen = true;
	}

	async function confirmCreate(e: SubmitEvent) {
		e.preventDefault();
		if (!newExpiresAt) {
			toast.error('Data de expiração obrigatória');
			return;
		}

		const rewards: Record<string, number> = {};
		if (newDraws > 0) rewards['usedDraws'] = newDraws;
		if (newCoins > 0) rewards['coins'] = newCoins;

		try {
			const res = await trpc().promoCodes.create.mutate({
				rewards,
				expiresAt: new Date(newExpiresAt).toISOString(),
				maxUses: newMaxUses || null
			});
			
			botUsername = res.botUsername;
			generatedLink = `https://t.me/${botUsername}?start=${res.code}`;
			toast.success('Código criado com sucesso');
			await loadRows();
		} catch (err) {
			toast.error('Erro ao criar código');
		}
	}

	async function deleteCode(id: number) {
		if (!confirm("Tem certeza que deseja deletar este código?")) return;
		try {
			await trpc().promoCodes.delete.mutate({ id });
			toast.success('Código deletado');
			await loadRows();
		} catch {
			toast.error('Erro ao deletar código');
		}
	}

	function linkCellRenderer(params: ICellRendererParams<PromoCodeRow>) {
		if (!params.data) return '';
		const code = params.data.code;
		const wrap = document.createElement('div');
		wrap.className = 'flex items-center gap-2 h-full';
		
		const span = document.createElement('span');
		span.textContent = code;
		span.className = 'font-mono text-magenta font-bold';
		
		const copyBtn = document.createElement('button');
		copyBtn.textContent = 'Copiar Link';
		copyBtn.className = 'text-xs bg-line px-2 py-1 rounded hover:bg-line-dim transition-colors';
		copyBtn.onclick = () => {
			navigator.clipboard.writeText(`https://t.me/${botUsername}?start=${code}`);
			toast.success('Link copiado!');
		};

		wrap.append(span, copyBtn);
		return wrap;
	}

	function actionCellRenderer(params: ICellRendererParams<PromoCodeRow>) {
		if (!params.data) return '';
		const btn = document.createElement('button');
		btn.textContent = 'Deletar';
		btn.className = 'text-xs bg-danger/20 text-danger px-2 py-1 rounded font-bold hover:bg-danger/30 h-max self-center';
		btn.onclick = () => deleteCode(params.data!.id);
		
		const wrap = document.createElement('div');
		wrap.className = 'flex h-full items-center';
		wrap.appendChild(btn);
		return wrap;
	}

	function rewardsRenderer(params: ICellRendererParams<PromoCodeRow>) {
		if (!params.data) return '';
		const rewards = params.data.rewards;
		let str = [];
		if (rewards['usedDraws']) str.push(`${rewards['usedDraws']} Giros`);
		if (rewards['coins']) str.push(`${rewards['coins']} Moedas`);
		return str.join(', ');
	}

	const theme = themeQuartz.withPart(colorSchemeDark).withParams({
		accentColor: 'var(--color-magenta)',
		backgroundColor: 'var(--color-panel)',
		foregroundColor: 'var(--color-ink)',
		borderColor: 'var(--color-line)',
		fontFamily: 'inherit',
		wrapperBorderRadius: 16
	});

	const gridOptions: GridOptions<PromoCodeRow> = {
		theme,
		rowModelType: 'clientSide',
		rowData: rows,
		domLayout: 'autoHeight',
		defaultColDef: { sortable: true, filter: true, resizable: true },
		columnDefs: [
			{ headerName: 'Código', cellRenderer: linkCellRenderer, flex: 2, minWidth: 200 },
			{ headerName: 'Recompensas', cellRenderer: rewardsRenderer, flex: 2 },
			{ headerName: 'Expira Em', field: 'expiresAt', valueFormatter: p => new Date(p.value).toLocaleString(), width: 160 },
			{ headerName: 'Usos', valueGetter: p => `${p.data?.redemptions || 0} / ${p.data?.maxUses ? p.data.maxUses : '∞'}`, width: 120 },
			{ headerName: 'Ações', cellRenderer: actionCellRenderer, sortable: false, filter: false, width: 100 }
		]
	};

	onMount(() => {
		gridApi = createGrid(gridDiv, gridOptions);
		loadRows();
	});

	onDestroy(() => {
		gridApi?.destroy();
	});
</script>

<div class="mb-4 flex items-center justify-between">
	<button class="btn btn-primary" onclick={openCreateDialog}>Criar Código</button>
</div>

<div bind:this={gridDiv}></div>

<Modal bind:open={createDialogOpen} title="Criar Código Promocional">
	{#if generatedLink}
		<div class="mb-6 bg-line p-4 rounded-lg flex flex-col gap-2">
			<span class="text-ink-dim text-sm">Código criado com sucesso! Compartilhe o link abaixo:</span>
			<div class="flex gap-2">
				<input type="text" class="field flex-1 font-mono" readonly value={generatedLink} />
				<button class="btn btn-secondary" onclick={() => { navigator.clipboard.writeText(generatedLink!); toast.success('Copiado!'); }}>Copiar</button>
			</div>
		</div>
		<div class="flex justify-end mt-4">
			<button type="button" class="btn btn-ghost" onclick={() => (createDialogOpen = false)}>Fechar</button>
		</div>
	{:else}
		<form onsubmit={confirmCreate} class="flex flex-col gap-4">
			
			<div class="flex gap-4">
				<div class="flex-1">
					<label class="block text-sm text-ink-dim mb-1 font-bold">Giros a dar</label>
					<input type="number" min="0" bind:value={newDraws} class="field w-full" />
				</div>
				<div class="flex-1">
					<label class="block text-sm text-ink-dim mb-1 font-bold">Moedas a dar</label>
					<input type="number" min="0" bind:value={newCoins} class="field w-full" />
				</div>
			</div>

			<div>
				<label class="block text-sm text-ink-dim mb-1 font-bold">Data de Expiração</label>
				<input type="datetime-local" bind:value={newExpiresAt} class="field w-full" required />
			</div>

			<div>
				<label class="block text-sm text-ink-dim mb-1 font-bold">Limite de Usos (opcional)</label>
				<input type="number" min="1" bind:value={newMaxUses} placeholder="Ex: 100 (vazio = ilimitado)" class="field w-full" />
			</div>

			<div class="mt-4 flex justify-end gap-2">
				<button type="button" class="btn btn-ghost" onclick={() => (createDialogOpen = false)}>Cancelar</button>
				<button type="submit" class="btn btn-primary">Criar Código</button>
			</div>
		</form>
	{/if}
</Modal>
