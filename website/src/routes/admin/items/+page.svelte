<script lang="ts">
	import { trpc } from '$lib/trpc/client';
	import { toast } from '$lib/stores/toast.svelte';
	import Button from '$lib/components/Button.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ItemActionsMenu from '$lib/components/ItemActionsMenu.svelte';

	let { data } = $props();

	// svelte-ignore state_referenced_locally -- kept in sync via $effect below (is this needed?)
	let items = $state(data.items.filter((item) => item.type !== 'profile'));
	$effect(() => {
		items = data.items.filter((item) => item.type !== 'profile');
	});

	let query = $state('');
	let typeFilter = $state<'all' | 'background' | 'sticker'>('all');
	let page = $state(1);
	const pageSize = 24;

	const typeTabs = [
		{ value: 'all', label: 'Todos' },
		{ value: 'background', label: 'Fundos' },
		{ value: 'sticker', label: 'Figurinhas' }
	] as const;

	let filtered = $derived(
		items.filter(
			(item) =>
				item.title.toLowerCase().includes(query.toLowerCase()) &&
				(typeFilter === 'all' || item.type === typeFilter)
		)
	);

	let totalPages = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
	let paged = $derived(filtered.slice((page - 1) * pageSize, page * pageSize));

	let backgrounds = $derived(paged.filter((item) => item.type === 'background'));
	let squareItems = $derived(paged.filter((item) => item.type === 'sticker'));

	$effect(() => {
		query;
		typeFilter;
		page = 1;
	});

	type Item = (typeof data.items)[number];

	async function toggleAvailable(id: number, isAvailable: boolean) {
		const idx = items.findIndex((i) => i.id === id);
		if (idx === -1) return;
		const prev = items[idx];
		items[idx] = { ...prev, isAvailable: !isAvailable };
		try {
			await trpc().items.update.mutate({ id, isAvailable: !isAvailable });
			toast.success(!isAvailable ? 'Item disponibilizado' : 'Item ocultado');
		} catch {
			items[idx] = prev;
			toast.error('Falha ao atualizar item');
		}
	}

	let editDialogOpen = $state(false);
	let editId = $state<number | null>(null);
	let editTitle = $state('');
	let editDescription = $state('');
	let editPrice = $state(0);
	let editItemURL = $state('');

	function openEdit(item: Item) {
		editId = item.id;
		editTitle = item.title;
		editDescription = item.description;
		editPrice = item.price;
		editItemURL = item.itemURL;
		editDialogOpen = true;
	}

	async function saveEdit(e: SubmitEvent) {
		e.preventDefault();
		if (editId === null) return;
		const idx = items.findIndex((i) => i.id === editId);
		if (idx === -1) return;
		const prev = items[idx];
		const patch = { title: editTitle, description: editDescription, price: editPrice, itemURL: editItemURL };
		items[idx] = { ...prev, ...patch };
		editDialogOpen = false;
		try {
			await trpc().items.update.mutate({ id: editId, ...patch });
			toast.success('Item atualizado');
		} catch {
			items[idx] = prev;
			toast.error('Falha ao salvar item');
		}
	}

	let deleteDialogOpen = $state(false);
	let deleteTarget = $state<Item | null>(null);

	function openDelete(item: Item) {
		deleteTarget = item;
		deleteDialogOpen = true;
	}

	async function confirmDelete() {
		if (!deleteTarget) return;
		const id = deleteTarget.id;
		deleteDialogOpen = false;
		const idx = items.findIndex((i) => i.id === id);
		const prev = items[idx];
		if (idx !== -1) items.splice(idx, 1);
		try {
			await trpc().items.delete.mutate({ id });
			toast.success('Item excluído');
		} catch {
			if (idx !== -1 && prev) items.splice(idx, 0, prev);
			toast.error('Falha ao excluir item');
		}
	}
</script>

<h1 class="text-ink mb-6 text-2xl font-bold">Loja</h1>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<input type="search" bind:value={query} placeholder="Buscar por título…" class="field max-w-sm" />

	<div class="flex gap-1">
		{#each typeTabs as tab (tab.value)}
			<button
				onclick={() => (typeFilter = tab.value)}
				class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
				class:bg-bg-soft={typeFilter === tab.value}
				class:text-magenta={typeFilter === tab.value}
				class:text-ink-dim={typeFilter !== tab.value}
			>
				{tab.label}
			</button>
		{/each}
	</div>
</div>

{#if filtered.length === 0}
	<p class="text-ink-dim text-sm">Nenhum item encontrado.</p>
{/if}

{#if backgrounds.length > 0}
	<div class="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
		{#each backgrounds as item (item.id)}
			<div class="border-line bg-panel overflow-hidden rounded-xl border">
				<div class="bg-bg-soft aspect-[4.5/1]">
					<img src={item.itemURL} alt={item.title} class="h-full w-full object-cover" loading="lazy" />
				</div>
				<div class="flex items-center justify-between gap-3 p-3">
					<div class="min-w-0">
						<p class="text-ink truncate text-sm font-medium">{item.title}</p>
						<p class="text-ink-dim text-xs">
							{item.price} moedas
							{#if !item.isAvailable}· oculto{/if}
						</p>
					</div>
					<ItemActionsMenu
						isAvailable={item.isAvailable}
						onEdit={() => openEdit(item)}
						onToggleAvailable={() => toggleAvailable(item.id, item.isAvailable)}
						onDelete={() => openDelete(item)}
					/>
				</div>
			</div>
		{/each}
	</div>
{/if}

{#if squareItems.length > 0}
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
		{#each squareItems as item (item.id)}
			<div class="border-line bg-panel overflow-hidden rounded-xl border">
				<div class="bg-bg-soft aspect-square">
					<img src={item.itemURL} alt={item.title} class="h-full w-full object-cover" loading="lazy" />
				</div>
				<div class="flex items-start justify-between gap-2 p-3">
					<div class="min-w-0">
						<p class="text-ink truncate text-sm font-medium">{item.title}</p>
						<p class="text-ink-dim text-xs">
							{item.price} moedas
							{#if !item.isAvailable}· oculto{/if}
						</p>
					</div>
					<ItemActionsMenu
						isAvailable={item.isAvailable}
						onEdit={() => openEdit(item)}
						onToggleAvailable={() => toggleAvailable(item.id, item.isAvailable)}
						onDelete={() => openDelete(item)}
					/>
				</div>
			</div>
		{/each}
	</div>
{/if}

{#if totalPages > 1}
	<div class="mt-8 flex items-center justify-center gap-3">
		<Button variant="ghost" disabled={page === 1} onclick={() => page--}>Anterior</Button>
		<span class="text-ink-dim text-sm">Página {page} de {totalPages}</span>
		<Button variant="ghost" disabled={page === totalPages} onclick={() => page++}>Próxima</Button>
	</div>
{/if}

<Modal bind:open={editDialogOpen} title="Editar item">
	<form onsubmit={saveEdit} class="flex flex-col gap-3">
		<label class="text-ink-dim text-xs">
			Imagem (URL)
			<input bind:value={editItemURL} class="field mt-1" />
		</label>
		<label class="text-ink-dim text-xs">
			Título
			<input bind:value={editTitle} class="field mt-1" />
		</label>
		<label class="text-ink-dim text-xs">
			Descrição
			<textarea bind:value={editDescription} rows="3" class="field mt-1"></textarea>
		</label>
		<label class="text-ink-dim text-xs">
			Preço
			<input type="number" bind:value={editPrice} class="field mt-1" />
		</label>
		<div class="mt-2 flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (editDialogOpen = false)}>Cancelar</button>
			<button type="submit" class="btn btn-default">Salvar</button>
		</div>
	</form>
</Modal>

<Modal bind:open={deleteDialogOpen} title="Excluir item">
	<p class="text-ink-dim text-sm">
		Tem certeza que deseja excluir <span class="text-ink font-medium">{deleteTarget?.title}</span>? Essa ação é
		permanente: quem comprou o item vai perdê-lo, e quem o tiver equipado vai ficar sem ele.
	</p>
	<div class="mt-4 flex justify-end gap-2">
		<button type="button" class="btn btn-ghost" onclick={() => (deleteDialogOpen = false)}>Cancelar</button>
		<button type="button" class="btn btn-danger" onclick={confirmDelete}>Excluir</button>
	</div>
</Modal>
