<script lang="ts">
	import { onMount, onDestroy, mount, unmount } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import CardActionsMenu from '$lib/components/CardActionsMenu.svelte';
	import SubcategoryPicker from '$lib/components/SubcategoryPicker.svelte';
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
	import { trpc } from '$lib/trpc/client';
	import { toast } from '$lib/stores/toast.svelte';

	ModuleRegistry.registerModules([AllCommunityModule]);

	type CardRow = {
		id: number;
		name: string;
		imageUrl: string | null;
		rarityModifier: number;
		rarityName: string;
		rarityEmoji: string;
		categoryName: string | null;
		subcategoryName: string | null;
		ownerCount: number;
		totalCopies: number;
	};
	type Rarity = { id: number; name: string; emoji: string };
	type Category = { id: number; name: string; emoji: string };
	type Subcategory = { id: number; name: string; cardCount: number };

	let { rarities, categories }: { rarities: Rarity[]; categories: Category[] } = $props();

	let gridDiv: HTMLDivElement;
	let gridApi: GridApi<CardRow> | undefined;
	let query = $state('');

	$effect(() => {
		query;
		gridApi?.purgeInfiniteCache();
	});

	const rarityColors: Record<string, string> = {
		Comum: 'var(--color-ink-dim)',
		Raro: 'var(--color-cyan)',
		Lendário: 'var(--color-yellow)'
	};

	function thumbnailCellRenderer(params: ICellRendererParams<CardRow>) {
		if (!params.data) return document.createElement('span');
		const img = document.createElement('img');
		img.src = params.data.imageUrl ?? '';
		img.width = 32;
		img.height = 32;
		img.className = 'rounded-md object-cover shrink-0 self-center';
		img.onerror = () => {
			const fallback = document.createElement('div');
			fallback.className = 'bg-bg-soft rounded-md shrink-0 self-center';
			fallback.style.width = '32px';
			fallback.style.height = '32px';
			img.replaceWith(fallback);
		};
		return img;
	}

	function rarityCellRenderer(params: ICellRendererParams<CardRow>) {
		const span = document.createElement('span');
		if (!params.data) return span;
		const color = rarityColors[params.data.rarityName] ?? 'var(--color-ink-dim)';
		span.textContent = `${params.data.rarityEmoji} ${params.data.rarityName}`;
		span.className = 'inline-flex h-5 shrink-0 self-center items-center rounded-full px-2 text-[11px] font-medium leading-none';
		span.style.color = color;
		span.style.background = `color-mix(in oklab, ${color} 15%, transparent)`;
		return span;
	}

	class ActionsCellRenderer {
		eGui!: HTMLDivElement;
		instance?: object;

		init(params: ICellRendererParams<CardRow>) {
			this.eGui = document.createElement('div');
			this.eGui.className = 'flex h-full items-center';
			if (!params.data) return;
			this.instance = mount(CardActionsMenu, {
				target: this.eGui,
				props: {
					onEdit: () => openEdit(params.data!),
					onDelete: () => openDelete(params.data!),
					onForceDelete: () => openForceDelete(params.data!)
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
				const result = await trpc().cards.list.query({
					offset: params.startRow,
					limit: params.endRow - params.startRow,
					query: query || undefined,
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

	const gridOptions: GridOptions<CardRow> = {
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
			{ headerName: '', cellRenderer: thumbnailCellRenderer, sortable: false, width: 60 },
			{ headerName: 'Nome', field: 'name', flex: 2, minWidth: 180 },
			{ headerName: 'Raridade', field: 'rarityName', cellRenderer: rarityCellRenderer, sortable: false, width: 130 },
			{ headerName: 'Categoria', field: 'categoryName', sortable: false, width: 140 },
			{ headerName: 'Subcategoria', field: 'subcategoryName', sortable: false, width: 160 },
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

	let formDialogOpen = $state(false);
	let formMode = $state<'create' | 'edit'>('create');
	let editId = $state<number | null>(null);
	let formName = $state('');
	let formImageUrl = $state('');
	let formRarityId = $state<number | null>(null);
	let formRarityModifier = $state(100);
	let formCategoryId = $state<number | null>(null);
	let formSubcategoryId = $state<number | null>(null);
	let formSecondaryIds = $state<number[]>([]);
	let formSubcategories = $state<Subcategory[]>([]);

	$effect(() => {
		const categoryId = formCategoryId;
		if (categoryId === null) {
			formSubcategories = [];
			return;
		}
		trpc()
			.categories.subcategories.query({ categoryId })
			.then((result) => {
				if (formCategoryId === categoryId) formSubcategories = result;
			})
			.catch(() => toast.error('Falha ao carregar subcategorias'));
	});

	function openCreate() {
		formMode = 'create';
		editId = null;
		formName = '';
		formImageUrl = '';
		formRarityId = rarities[0]?.id ?? null;
		formRarityModifier = 100;
		formCategoryId = categories[0]?.id ?? null;
		formSubcategoryId = null;
		formSecondaryIds = [];
		formDialogOpen = true;
	}

	async function openEdit(row: CardRow) {
		formMode = 'edit';
		editId = row.id;
		formDialogOpen = true;
		try {
			const full = await trpc().cards.get.query({ id: row.id });
			if (!full) return;
			formName = full.name;
			formImageUrl = full.imageUrl ?? '';
			formRarityId = full.rarityId;
			formRarityModifier = full.rarityModifier;
			formCategoryId = full.categoryId;
			formSubcategoryId = full.subcategoryId;
			formSecondaryIds = full.secondarySubcategoryIds;
		} catch {
			toast.error('Falha ao carregar carta');
			formDialogOpen = false;
		}
	}

	async function saveForm(e: SubmitEvent) {
		e.preventDefault();
		if (formRarityId === null || formSubcategoryId === null) return;
		formDialogOpen = false;

		if (formMode === 'create') {
			try {
				await trpc().cards.create.mutate({
					name: formName,
					imageUrl: formImageUrl,
					rarityId: formRarityId,
					subcategoryId: formSubcategoryId,
					secondarySubcategoryIds: formSecondaryIds
				});
				gridApi?.purgeInfiniteCache();
				toast.success('Carta criada');
			} catch {
				toast.error('Falha ao criar carta');
			}
			return;
		}

		if (editId === null) return;
		try {
			await trpc().cards.update.mutate({
				id: editId,
				name: formName,
				imageUrl: formImageUrl,
				rarityId: formRarityId,
				rarityModifier: formRarityModifier
			});
			await trpc().cards.updateSubcategories.mutate({
				id: editId,
				subcategoryId: formSubcategoryId,
				secondarySubcategoryIds: formSecondaryIds
			});
			const rarity = rarities.find((r) => r.id === formRarityId);
			const category = categories.find((c) => c.id === formCategoryId);
			const subcategory = formSubcategories.find((s) => s.id === formSubcategoryId);
			const rowNode = gridApi?.getRowNode(String(editId));
			if (rowNode?.data) {
				rowNode.setData({
					...rowNode.data,
					name: formName,
					imageUrl: formImageUrl,
					rarityModifier: formRarityModifier,
					rarityName: rarity?.name ?? rowNode.data.rarityName,
					rarityEmoji: rarity?.emoji ?? rowNode.data.rarityEmoji,
					categoryName: category?.name ?? rowNode.data.categoryName,
					subcategoryName: subcategory?.name ?? rowNode.data.subcategoryName
				});
			}
			toast.success('Carta atualizada');
		} catch {
			toast.error('Falha ao atualizar carta');
		}
	}


	let deleteDialogOpen = $state(false);
	let deleteTarget = $state<CardRow | null>(null);

	function openDelete(row: CardRow) {
		deleteTarget = row;
		deleteDialogOpen = true;
	}

	async function confirmDelete() {
		if (!deleteTarget) return;
		const id = deleteTarget.id;
		deleteDialogOpen = false;
		try {
			const result = await trpc().cards.delete.mutate({ id });
			if (result.ok) {
				gridApi?.purgeInfiniteCache();
				toast.success('Carta excluída');
			} else {
				toast.error(
					result.reason === 'has_owners' ? 'Ainda há usuários com esta carta' : 'Há giros registrados para esta carta'
				);
			}
		} catch {
			toast.error('Falha ao excluir carta');
		}
	}


	let forceDeleteDialogOpen = $state(false);
	let forceDeleteTarget = $state<CardRow | null>(null);
	let forceDeleteConfirmText = $state('');

	function openForceDelete(row: CardRow) {
		forceDeleteTarget = row;
		forceDeleteConfirmText = '';
		forceDeleteDialogOpen = true;
	}

	async function confirmForceDelete() {
		if (!forceDeleteTarget || forceDeleteConfirmText !== forceDeleteTarget.name) return;
		const id = forceDeleteTarget.id;
		forceDeleteDialogOpen = false;
		try {
			await trpc().cards.forceDelete.mutate({ id });
			gridApi?.purgeInfiniteCache();
			toast.success('Carta e histórico excluídos');
		} catch {
			toast.error('Falha ao excluir carta');
		}
	}
</script>

<div class="mb-4 flex items-center justify-between gap-3">
	<input type="search" bind:value={query} placeholder="Buscar por nome…" class="field max-w-sm" />
	<button class="btn btn-default" onclick={openCreate}>+ Nova carta</button>
</div>

<div bind:this={gridDiv}></div>

<Modal bind:open={formDialogOpen} title={formMode === 'create' ? 'Nova carta' : 'Editar carta'}>
	<form onsubmit={saveForm} class="flex flex-col gap-3">
		<label class="text-ink-dim text-xs">
			Nome
			<input bind:value={formName} class="field mt-1" required />
		</label>
		<label class="text-ink-dim text-xs">
			Imagem (URL)
			<input bind:value={formImageUrl} class="field mt-1" required />
		</label>
		<label class="text-ink-dim text-xs">
			Raridade
			<select bind:value={formRarityId} class="field mt-1">
				{#each rarities as rarity (rarity.id)}
					<option value={rarity.id}>{rarity.emoji} {rarity.name}</option>
				{/each}
			</select>
		</label>
		{#if formMode === 'edit'}
			<label class="text-ink-dim text-xs">
				Modificador de raridade (%)
				<input type="number" bind:value={formRarityModifier} class="field mt-1" />
			</label>
		{/if}
		<label class="text-ink-dim text-xs">
			Categoria
			<select bind:value={formCategoryId} class="field mt-1">
				{#each categories as category (category.id)}
					<option value={category.id}>{category.emoji} {category.name}</option>
				{/each}
			</select>
		</label>
		<label class="text-ink-dim text-xs">
			Subcategoria principal
			<select bind:value={formSubcategoryId} class="field mt-1">
				<option value={null} disabled>Selecione…</option>
				{#each formSubcategories as sub (sub.id)}
					<option value={sub.id}>{sub.name}</option>
				{/each}
			</select>
		</label>
		<div class="text-ink-dim text-xs">
			Tags secundárias
			<div class="mt-1">
				<SubcategoryPicker bind:selected={formSecondaryIds} excludeId={formSubcategoryId} />
			</div>
		</div>
		<div class="mt-2 flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (formDialogOpen = false)}>Cancelar</button>
			<button type="submit" class="btn btn-default">Salvar</button>
		</div>
	</form>
</Modal>

<Modal bind:open={deleteDialogOpen} title="Excluir carta">
	<p class="text-ink-dim text-sm">
		Tem certeza que deseja excluir <span class="text-ink font-medium">{deleteTarget?.name}</span>?
	</p>
	<div class="mt-4 flex justify-end gap-2">
		<button type="button" class="btn btn-ghost" onclick={() => (deleteDialogOpen = false)}>Cancelar</button>
		<button type="button" class="btn btn-danger" onclick={confirmDelete}>Excluir</button>
	</div>
</Modal>

<Modal bind:open={forceDeleteDialogOpen} title="Forçar exclusão">
	<p class="text-ink-dim text-sm">
		<span class="text-magenta font-medium">Isso é permanente e não pode ser desfeito.</span> A carta
		<span class="text-ink font-medium">{forceDeleteTarget?.name}</span> será excluída junto com
		<span class="text-ink font-medium">{forceDeleteTarget?.totalCopies} cópias</span> pertencentes a
		<span class="text-ink font-medium">{forceDeleteTarget?.ownerCount} usuários</span> e todo o histórico de giros dessa
		carta.
	</p>
	<label class="text-ink-dim mt-4 block text-xs">
		Digite <span class="text-ink font-medium">{forceDeleteTarget?.name}</span> para confirmar
		<input bind:value={forceDeleteConfirmText} class="field mt-1" />
	</label>
	<div class="mt-4 flex justify-end gap-2">
		<button type="button" class="btn btn-ghost" onclick={() => (forceDeleteDialogOpen = false)}>Cancelar</button>
		<button
			type="button"
			class="btn btn-danger"
			disabled={forceDeleteConfirmText !== forceDeleteTarget?.name}
			onclick={confirmForceDelete}
		>
			Forçar exclusão
		</button>
	</div>
</Modal>
