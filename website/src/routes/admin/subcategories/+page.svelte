<script lang="ts">
	import { onMount, onDestroy, mount, unmount } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import RowActionsMenu from '$lib/components/RowActionsMenu.svelte';
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
		type ICellRendererParams,
		type IDatasource
	} from 'ag-grid-community';

	ModuleRegistry.registerModules([AllCommunityModule]);

	type SubcategoryRow = {
		id: number;
		name: string;
		categoryId: number;
		categoryName: string;
		tags: string[] | null;
		isSecondary: boolean;
		imageUrl: string | null;
		rarityModifier: number;
	};

	let { data } = $props();

	let gridDiv: HTMLDivElement;
	let gridApi: GridApi<SubcategoryRow> | undefined;
	let query = $state('');
	let categoryFilter = $state<number | 'all'>('all');

	$effect(() => {
		query;
		categoryFilter;
		gridApi?.purgeInfiniteCache();
	});

	function tagsCellRenderer(params: ICellRendererParams<SubcategoryRow>) {
		const span = document.createElement('span');
		if (!params.data) return span;
		span.textContent = (params.data.tags ?? []).join(', ');
		return span;
	}

	function secondaryCellRenderer(params: ICellRendererParams<SubcategoryRow, boolean>) {
		const span = document.createElement('span');
		if (!params.value) return span;
		span.textContent = 'secundária';
		span.className =
			'inline-flex h-5 shrink-0 self-center items-center rounded-full bg-bg-soft text-ink-dim px-2 text-[11px] font-medium leading-none';
		return span;
	}

	class ActionsCellRenderer {
		eGui!: HTMLDivElement;
		instance?: object;

		init(params: ICellRendererParams<SubcategoryRow>) {
			this.eGui = document.createElement('div');
			this.eGui.className = 'flex h-full items-center';
			if (!params.data) return;
			this.instance = mount(RowActionsMenu, {
				target: this.eGui,
				props: {
					onEdit: () => openEdit(params.data!),
					onDelete: () => openDelete(params.data!)
				}
			});
		}

		getGui() {
			return this.eGui;
		}

		destroy() {
			if (this.instance) unmount(this.instance);
		}
	}

	const theme = themeQuartz.withPart(colorSchemeDark).withParams({
		accentColor: 'var(--color-magenta)',
		backgroundColor: 'var(--color-panel)',
		foregroundColor: 'var(--color-ink)',
		borderColor: 'var(--color-line)',
		fontFamily: 'inherit',
		wrapperBorderRadius: 16
	});

	const pageSize = 20;

	const datasource: IDatasource = {
		getRows: async (params) => {
			try {
				const sort = params.sortModel[0];
				const result = await trpc().categories.subcategoriesPaged.query({
					offset: params.startRow,
					limit: params.endRow - params.startRow,
					query: query || undefined,
					categoryId: categoryFilter === 'all' ? undefined : categoryFilter,
					sortField: sort?.colId === 'name' || sort?.colId === 'rarityModifier' ? sort.colId : undefined,
					sortDir: sort?.sort ?? undefined
				});
				const lastRow = params.startRow + result.rows.length >= result.total ? result.total : undefined;
				params.successCallback(result.rows, lastRow);
			} catch {
				params.failCallback();
			}
		}
	};

	const gridOptions: GridOptions<SubcategoryRow> = {
		theme,
		rowModelType: 'infinite',
		datasource,
		cacheBlockSize: pageSize,
		suppressLoadingOverlay: true,
		getRowId: (params) => (params.data ? String(params.data.id) : crypto.randomUUID()),
		domLayout: 'autoHeight',
		pagination: true,
		paginationPageSize: pageSize,
		defaultColDef: { sortable: true, filter: false, resizable: true },
		columnDefs: [
			{ headerName: 'Nome', field: 'name', flex: 2, minWidth: 180 },
			{ headerName: 'Categoria', field: 'categoryName', sortable: false, width: 140 },
			{ headerName: 'Tags', cellRenderer: tagsCellRenderer, sortable: false, flex: 1, minWidth: 140 },
			{ headerName: '', field: 'isSecondary', cellRenderer: secondaryCellRenderer, sortable: false, width: 110 },
			{ headerName: 'Cartas', field: 'cardCount', sortable: false, width: 90 },
			{
				headerName: 'Mod.',
				field: 'rarityModifier',
				valueFormatter: (p) => `${p.value}%`,
				width: 90
			},
			{ headerName: '', cellRenderer: ActionsCellRenderer, sortable: false, width: 70 }
		]
	};

	onMount(() => {
		gridApi = createGrid(gridDiv, gridOptions);
	});

	onDestroy(() => {
		gridApi?.destroy();
	});

	// --- create/edit ---

	let dialogOpen = $state(false);
	let dialogMode = $state<'create' | 'edit'>('create');
	let editId = $state<number | null>(null);
	let name = $state('');
	let categoryId = $state<number | null>(null);
	let tags = $state('');
	let isSecondary = $state(false);
	let imageUrl = $state('');
	let rarityModifier = $state(100);

	function openCreate() {
		dialogMode = 'create';
		editId = null;
		name = '';
		categoryId = categoryFilter === 'all' ? (data.categories[0]?.id ?? null) : categoryFilter;
		tags = '';
		isSecondary = false;
		imageUrl = '';
		rarityModifier = 100;
		dialogOpen = true;
	}

	async function openEdit(row: SubcategoryRow) {
		dialogMode = 'edit';
		editId = row.id;
		name = row.name;
		categoryId = row.categoryId;
		tags = (row.tags ?? []).join(', ');
		isSecondary = row.isSecondary;
		imageUrl = row.imageUrl ?? '';
		rarityModifier = row.rarityModifier;
		dialogOpen = true;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		dialogOpen = false;

		if (dialogMode === 'create') {
			if (categoryId === null) return;
			try {
				await trpc().categories.createSubcategory.mutate({ name, categoryId });
				gridApi?.purgeInfiniteCache();
				toast.success('Subcategoria criada');
			} catch {
				toast.error('Falha ao criar subcategoria');
			}
			return;
		}

		if (editId === null) return;
		const tagList = tags
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		try {
			await trpc().categories.updateSubcategory.mutate({
				id: editId,
				name,
				tags: tagList,
				isSecondary,
				imageUrl: imageUrl || undefined,
				rarityModifier
			});
			const rowNode = gridApi?.getRowNode(String(editId));
			if (rowNode?.data) rowNode.setData({ ...rowNode.data, name, tags: tagList, isSecondary, imageUrl: imageUrl || null, rarityModifier });
			toast.success('Subcategoria atualizada');
		} catch {
			toast.error('Falha ao atualizar subcategoria');
		}
	}

	// --- delete ---

	let deleteDialogOpen = $state(false);
	let deleteTarget = $state<SubcategoryRow | null>(null);

	function openDelete(row: SubcategoryRow) {
		deleteTarget = row;
		deleteDialogOpen = true;
	}

	async function confirmDelete() {
		if (!deleteTarget) return;
		const id = deleteTarget.id;
		deleteDialogOpen = false;
		try {
			const result = await trpc().categories.deleteSubcategory.mutate({ id });
			if (result.ok) {
				gridApi?.purgeInfiniteCache();
				toast.success('Subcategoria excluída');
			} else {
				toast.error(
					result.reason === 'has_cards' ? 'Ainda há cartas nessa subcategoria' : 'Existem giros registrados nessa subcategoria'
				);
			}
		} catch {
			toast.error('Falha ao excluir subcategoria');
		}
	}
</script>

<h1 class="text-ink mb-6 text-2xl font-bold">Subcategorias</h1>

<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
	<div class="flex flex-wrap items-center gap-3">
		<input type="search" bind:value={query} placeholder="Buscar por nome…" class="field max-w-sm" />

		<div class="flex flex-wrap gap-1">
			<button
				onclick={() => (categoryFilter = 'all')}
				class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
				class:bg-bg-soft={categoryFilter === 'all'}
				class:text-magenta={categoryFilter === 'all'}
				class:text-ink-dim={categoryFilter !== 'all'}
			>
				Todos
			</button>
			{#each data.categories as category (category.id)}
				<button
					onclick={() => (categoryFilter = category.id)}
					class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
					class:bg-bg-soft={categoryFilter === category.id}
					class:text-magenta={categoryFilter === category.id}
					class:text-ink-dim={categoryFilter !== category.id}
				>
					{category.emoji} {category.name}
				</button>
			{/each}
		</div>
	</div>

	<button class="btn btn-default" onclick={openCreate}>+ Nova subcategoria</button>
</div>

<div bind:this={gridDiv}></div>

<Modal bind:open={dialogOpen} title={dialogMode === 'create' ? 'Nova subcategoria' : 'Editar subcategoria'}>
	<form onsubmit={save} class="flex flex-col gap-3">
		<label class="text-ink-dim text-xs">
			Nome
			<input bind:value={name} class="field mt-1" required />
		</label>
		{#if dialogMode === 'create'}
			<label class="text-ink-dim text-xs">
				Categoria
				<select bind:value={categoryId} class="field mt-1">
					{#each data.categories as category (category.id)}
						<option value={category.id}>{category.emoji} {category.name}</option>
					{/each}
				</select>
			</label>
		{:else}
			<label class="text-ink-dim text-xs">
				Tags (separadas por vírgula)
				<input bind:value={tags} class="field mt-1" />
			</label>
			<label class="text-ink flex items-center gap-2 text-xs">
				<input type="checkbox" bind:checked={isSecondary} />
				Secundária
			</label>
			<label class="text-ink-dim text-xs">
				Imagem (URL)
				<input bind:value={imageUrl} class="field mt-1" />
			</label>
			<label class="text-ink-dim text-xs">
				Modificador de raridade (%)
				<input type="number" bind:value={rarityModifier} class="field mt-1" />
			</label>
		{/if}
		<div class="mt-2 flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (dialogOpen = false)}>Cancelar</button>
			<button type="submit" class="btn btn-default">Salvar</button>
		</div>
	</form>
</Modal>

<Modal bind:open={deleteDialogOpen} title="Excluir subcategoria">
	<p class="text-ink-dim text-sm">
		Tem certeza que deseja excluir <span class="text-ink font-medium">{deleteTarget?.name}</span>?
	</p>
	<div class="mt-4 flex justify-end gap-2">
		<button type="button" class="btn btn-ghost" onclick={() => (deleteDialogOpen = false)}>Cancelar</button>
		<button type="button" class="btn btn-danger" onclick={confirmDelete}>Excluir</button>
	</div>
</Modal>
