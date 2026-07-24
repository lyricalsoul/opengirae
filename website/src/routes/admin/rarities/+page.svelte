<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { trpc } from '$lib/trpc/client';
	import { toast } from '$lib/stores/toast.svelte';
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

	ModuleRegistry.registerModules([AllCommunityModule]);

	let { data } = $props();

	type Rarity = (typeof data.rarities)[number];

	let gridDiv: HTMLDivElement;
	let gridApi: GridApi<Rarity> | undefined;

	function nameCellRenderer(params: ICellRendererParams<Rarity>) {
		const span = document.createElement('span');
		span.textContent = `${params.data!.emoji} ${params.data!.name}`;
		return span;
	}

	function editCellRenderer(params: ICellRendererParams<Rarity>) {
		const button = document.createElement('button');
		button.textContent = 'Editar';
		button.className = 'text-ink-dim hover:text-ink text-xs';
		button.onclick = () => openEdit(params.data!);
		return button;
	}

	const theme = themeQuartz.withPart(colorSchemeDark).withParams({
		accentColor: 'var(--color-magenta)',
		backgroundColor: 'var(--color-panel)',
		foregroundColor: 'var(--color-ink)',
		borderColor: 'var(--color-line)',
		fontFamily: 'inherit',
		wrapperBorderRadius: 16
	});

	const gridOptions: GridOptions<Rarity> = {
		theme,
		// svelte-ignore state_referenced_locally -- deliberate: rarities are a small curated set, loaded once
		rowData: data.rarities,
		getRowId: (params) => String(params.data.id),
		domLayout: 'autoHeight',
		defaultColDef: { sortable: true, filter: false, resizable: true },
		columnDefs: [
			{ headerName: 'Raridade', cellRenderer: nameCellRenderer, field: 'name', flex: 2, minWidth: 160 },
			{ headerName: 'Peso', field: 'weight', width: 100 },
			{ headerName: 'Qtd. p/ cativeiro', field: 'cativeiroThreshold', width: 160 },
			{ headerName: '', cellRenderer: editCellRenderer, sortable: false, width: 80 }
		]
	};

	onMount(() => {
		gridApi = createGrid(gridDiv, gridOptions);
	});

	onDestroy(() => {
		gridApi?.destroy();
	});

	let dialogOpen = $state(false);
	let editId = $state<number | null>(null);
	let name = $state('');
	let emoji = $state('');
	let weight = $state(0);
	let cativeiroThreshold = $state(0);

	function openEdit(rarity: Rarity) {
		editId = rarity.id;
		name = rarity.name;
		emoji = rarity.emoji;
		weight = rarity.weight;
		cativeiroThreshold = rarity.cativeiroThreshold;
		dialogOpen = true;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		dialogOpen = false;
		if (editId === null) return;

		const rowNode = gridApi?.getRowNode(String(editId));
		const prev = rowNode?.data;
		const patch = { name, emoji, weight, cativeiroThreshold };
		if (rowNode?.data) rowNode.setData({ ...rowNode.data, ...patch });
		try {
			await trpc().rarities.update.mutate({ id: editId, ...patch });
			toast.success('Raridade atualizada');
		} catch {
			if (prev) rowNode?.setData(prev);
			toast.error('Falha ao atualizar raridade');
		}
	}
</script>

<h1 class="text-ink mb-6 text-2xl font-bold">Raridades</h1>

<div bind:this={gridDiv}></div>

<Modal bind:open={dialogOpen} title="Editar raridade">
	<form onsubmit={save} class="flex flex-col gap-3">
		<label class="text-ink-dim text-xs">
			Nome
			<input bind:value={name} class="field mt-1" required />
		</label>
		<label class="text-ink-dim text-xs">
			Emoji
			<input bind:value={emoji} class="field mt-1" required />
		</label>
		<label class="text-ink-dim text-xs">
			Peso (chance de sorteio)
			<input type="number" bind:value={weight} class="field mt-1" />
		</label>
		<label class="text-ink-dim text-xs">
			Quantidade para cativeiro
			<input type="number" bind:value={cativeiroThreshold} class="field mt-1" />
		</label>
		<div class="mt-2 flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (dialogOpen = false)}>Cancelar</button>
			<button type="submit" class="btn btn-default">Salvar</button>
		</div>
	</form>
</Modal>
