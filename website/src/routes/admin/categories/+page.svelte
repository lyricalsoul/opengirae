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

	type Category = (typeof data.categories)[number];

	let gridDiv: HTMLDivElement;
	let gridApi: GridApi<Category> | undefined;

	function nameCellRenderer(params: ICellRendererParams<Category>) {
		const span = document.createElement('span');
		span.textContent = `${params.data!.emoji} ${params.data!.name}`;
		return span;
	}

	function hiddenCellRenderer(params: ICellRendererParams<Category, boolean>) {
		const span = document.createElement('span');
		if (!params.value) return span;
		span.textContent = 'oculta';
		span.className = 'inline-flex h-5 shrink-0 self-center items-center rounded-full bg-bg-soft text-ink-dim px-2 text-[11px] font-medium leading-none';
		return span;
	}

	function editCellRenderer(params: ICellRendererParams<Category>) {
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

	const gridOptions: GridOptions<Category> = {
		theme,
		// svelte-ignore state_referenced_locally -- deliberate: categories are a small curated set, loaded once
		rowData: data.categories,
		getRowId: (params) => String(params.data.id),
		domLayout: 'autoHeight',
		pagination: true,
		paginationPageSize: 20,
		defaultColDef: { sortable: true, filter: false, resizable: true },
		columnDefs: [
			{ headerName: 'Categoria', cellRenderer: nameCellRenderer, field: 'name', flex: 2, minWidth: 180 },
			{ headerName: 'Subcategorias por giro', field: 'subcategoriesOnDraw', width: 180 },
			{ headerName: '', field: 'isHidden', cellRenderer: hiddenCellRenderer, sortable: false, width: 100 },
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
	let dialogMode = $state<'create' | 'edit'>('create');
	let editId = $state<number | null>(null);
	let name = $state('');
	let emoji = $state('🏷️');
	let subcategoriesOnDraw = $state(4);
	let isHidden = $state(false);
	let drawImageUrl = $state('');

	function openCreate() {
		dialogMode = 'create';
		editId = null;
		name = '';
		emoji = '🏷️';
		subcategoriesOnDraw = 4;
		isHidden = false;
		drawImageUrl = '';
		dialogOpen = true;
	}

	function openEdit(category: Category) {
		dialogMode = 'edit';
		editId = category.id;
		name = category.name;
		emoji = category.emoji;
		subcategoriesOnDraw = category.subcategoriesOnDraw;
		isHidden = category.isHidden;
		drawImageUrl = category.drawImageUrl ?? '';
		dialogOpen = true;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		dialogOpen = false;

		if (dialogMode === 'create') {
			try {
				const created = await trpc().categories.createCategory.mutate({ name, emoji });
				if (created) gridApi?.applyTransaction({ add: [created] });
				toast.success('Categoria criada');
			} catch {
				toast.error('Falha ao criar categoria');
			}
			return;
		}

		if (editId === null) return;
		const rowNode = gridApi?.getRowNode(String(editId));
		const prev = rowNode?.data;
		const patch = { name, emoji, subcategoriesOnDraw, isHidden, drawImageUrl: drawImageUrl || undefined };
		if (rowNode?.data) rowNode.setData({ ...rowNode.data, ...patch, drawImageUrl: drawImageUrl || null });
		try {
			await trpc().categories.updateCategory.mutate({ id: editId, ...patch });
			toast.success('Categoria atualizada');
		} catch {
			if (prev) rowNode?.setData(prev);
			toast.error('Falha ao atualizar categoria');
		}
	}
</script>

<div class="mb-4 flex items-center justify-between">
	<h1 class="text-ink text-2xl font-bold">Categorias</h1>
	<button class="btn btn-default" onclick={openCreate}>+ Nova categoria</button>
</div>

<div bind:this={gridDiv}></div>

<Modal bind:open={dialogOpen} title={dialogMode === 'create' ? 'Nova categoria' : 'Editar categoria'}>
	<form onsubmit={save} class="flex flex-col gap-3">
		<label class="text-ink-dim text-xs">
			Nome
			<input bind:value={name} class="field mt-1" required />
		</label>
		<label class="text-ink-dim text-xs">
			Emoji
			<input bind:value={emoji} class="field mt-1" required />
		</label>
		{#if dialogMode === 'edit'}
			<label class="text-ink-dim text-xs">
				Subcategorias por giro
				<input type="number" bind:value={subcategoriesOnDraw} class="field mt-1" />
			</label>
			<label class="text-ink flex items-center gap-2 text-xs">
				<input type="checkbox" bind:checked={isHidden} />
				Oculta
			</label>
			<label class="text-ink-dim text-xs">
				Imagem de giro (URL)
				<input bind:value={drawImageUrl} class="field mt-1" />
			</label>
		{/if}
		<div class="mt-2 flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (dialogOpen = false)}>Cancelar</button>
			<button type="submit" class="btn btn-default">Salvar</button>
		</div>
	</form>
</Modal>
