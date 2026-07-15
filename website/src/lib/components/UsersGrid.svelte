<script lang="ts">
	import { onMount, onDestroy, mount, unmount } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
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
	import UserActionsMenu from '$lib/components/UserActionsMenu.svelte';

	ModuleRegistry.registerModules([AllCommunityModule]);

	type UserRow = {
		id: number;
		displayName: string;
		avatarUrl: string;
		coins: number;
		usedDraws: number;
		maxDraws: number;
		isBanned: boolean;
		isAdmin: boolean;
	};

	let gridDiv: HTMLDivElement;
	let gridApi: GridApi<UserRow> | undefined;
	let query = $state('');

	$effect(() => {
		query;
		gridApi?.purgeInfiniteCache();
	});

	let banDialogOpen = $state(false);
	let banTargetId = $state<number | null>(null);
	let banReason = $state('');

	function openBanDialog(userId: number) {
		banTargetId = userId;
		banReason = '';
		banDialogOpen = true;
	}

	async function applyBanned(userId: number, isBanned: boolean, banMessage?: string) {
		const rowNode = gridApi?.getRowNode(String(userId));
		const prev = rowNode?.data;
		if (rowNode?.data) rowNode.setData({ ...rowNode.data, isBanned });
		try {
			await trpc().users.setBanned.mutate({ userId, isBanned, banMessage });
			toast.success(isBanned ? 'Usuário banido' : 'Usuário desbanido');
		} catch {
			if (prev) rowNode?.setData(prev);
			toast.error('Falha ao atualizar usuário');
		}
	}

	async function confirmBan(e: SubmitEvent) {
		e.preventDefault();
		if (banTargetId === null) return;
		banDialogOpen = false;
		await applyBanned(banTargetId, true, banReason || undefined);
	}

	async function unban(userId: number) {
		await applyBanned(userId, false);
	}

	async function toggleAdmin(userId: number, isAdmin: boolean) {
		const rowNode = gridApi?.getRowNode(String(userId));
		const prev = rowNode?.data;
		const next = !isAdmin;
		if (rowNode?.data) rowNode.setData({ ...rowNode.data, isAdmin: next });
		try {
			await trpc().users.setIsAdmin.mutate({ userId, isAdmin: next });
			toast.success(next ? 'Agora é admin' : 'Admin removido');
		} catch {
			if (prev) rowNode?.setData(prev);
			toast.error('Falha ao atualizar usuário');
		}
	}

	function userCellRenderer(params: ICellRendererParams<UserRow>) {
		const wrap = document.createElement('div');
		wrap.className = 'flex h-full items-center gap-2';
		if (!params.data) return wrap;

		const img = document.createElement('img');
		img.src = params.data.avatarUrl;
		img.width = 32;
		img.height = 32;
		img.className = 'rounded-full object-cover shrink-0';
		img.onerror = () => {
			const fallback = document.createElement('div');
			fallback.className =
				'bg-bg-soft text-ink-dim flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold';
			fallback.textContent = params.data!.displayName.slice(0, 2).toUpperCase();
			img.replaceWith(fallback);
		};

		const name = document.createElement('span');
		name.textContent = params.data.displayName;

		wrap.append(img, name);
		return wrap;
	}

	function badgeCellRenderer(params: ICellRendererParams<UserRow, boolean>) {
		const span = document.createElement('span');
		span.textContent = params.value ? 'SIM' : 'não';
		span.className = params.value
			? 'inline-flex h-5 shrink-0 self-center items-center rounded-full bg-magenta/15 text-magenta px-2 text-[11px] font-medium leading-none'
			: 'inline-flex h-5 shrink-0 self-center items-center rounded-full bg-bg-soft text-ink-dim px-2 text-[11px] font-medium leading-none';
		return span;
	}

	class ActionsCellRenderer {
		eGui!: HTMLDivElement;
		instance?: object;

		init(params: ICellRendererParams<UserRow>) {
			this.eGui = document.createElement('div');
			this.eGui.className = 'flex h-full items-center';
			if (!params.data) return;
			this.instance = mount(UserActionsMenu, {
				target: this.eGui,
				props: {
					isBanned: params.data!.isBanned,
					isAdmin: params.data!.isAdmin,
					onBan: () => openBanDialog(params.data!.id),
					onUnban: () => unban(params.data!.id),
					onToggleAdmin: () => toggleAdmin(params.data!.id, params.data!.isAdmin)
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
	const sortableFields = ['displayName', 'coins', 'usedDraws', 'isBanned', 'isAdmin'] as const;

	const datasource: IDatasource = {
		getRows: async (params) => {
			try {
				const sort = params.sortModel[0];
				const sortField = sortableFields.find((f) => f === sort?.colId);
				const result = await trpc().users.list.query({
					offset: params.startRow,
					limit: params.endRow - params.startRow,
					query: query || undefined,
					sortField,
					sortDir: sort?.sort ?? undefined
				});
				const lastRow = params.startRow + result.rows.length >= result.total ? result.total : undefined;
				params.successCallback(result.rows, lastRow);
			} catch {
				params.failCallback();
			}
		}
	};

	const gridOptions: GridOptions<UserRow> = {
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
			{ headerName: 'Usuário', field: 'displayName', cellRenderer: userCellRenderer, flex: 2, minWidth: 220 },
			{ headerName: 'Moedas', field: 'coins', width: 120 },
			{
				headerName: 'Giros',
				field: 'usedDraws',
				valueFormatter: (p) => `${p.data?.usedDraws}/${p.data?.maxDraws}`,
				width: 110
			},
			{ headerName: 'Banido', field: 'isBanned', cellRenderer: badgeCellRenderer, width: 110 },
			{ headerName: 'Admin', field: 'isAdmin', cellRenderer: badgeCellRenderer, width: 110 },
			{ headerName: '', cellRenderer: ActionsCellRenderer, sortable: false, width: 70 }
		]
	};

	onMount(() => {
		gridApi = createGrid(gridDiv, gridOptions);
	});

	onDestroy(() => {
		gridApi?.destroy();
	});
</script>

<div class="mb-4">
	<input type="search" bind:value={query} placeholder="Buscar por nome…" class="field max-w-sm" />
</div>

<div bind:this={gridDiv}></div>

<Modal bind:open={banDialogOpen} title="Banir usuário">
	<form onsubmit={confirmBan}>
		<textarea bind:value={banReason} placeholder="Motivo do banimento (opcional)" rows="3" class="field"></textarea>
		<div class="mt-4 flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (banDialogOpen = false)}>Cancelar</button>
			<button type="submit" class="btn btn-danger">Banir</button>
		</div>
	</form>
</Modal>
