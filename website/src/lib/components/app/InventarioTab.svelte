<script lang="ts">
	import { Page, Navbar, Block, Segmented, SegmentedButton, Preloader, Toolbar, Button } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';

	type Item = { id: number; title: string; description: string; price: number; itemURL: string; type: 'background' | 'sticker' };
	type ItemType = 'background' | 'sticker';

	let type = $state<ItemType>('background');
	let items = $state<Item[]>([]);
	let itemsLoading = $state(false);

	let equippedBackgroundId = $state<number | null>(null);
	let equippedStickerId = $state<number | null>(null);

	let selectedBackgroundId = $state<number | null>(null);
	let selectedStickerId = $state<number | null>(null);

	let previewUrl = $state<string | null>(null);
	let previewLoading = $state(false);
	let saving = $state(false);

	let dirty = $derived(selectedBackgroundId !== equippedBackgroundId || selectedStickerId !== equippedStickerId);

	async function loadEquipped() {
		const equipped = await telegramTrpc.telegram.store.equippedItemIds.query();
		equippedBackgroundId = equipped.background;
		equippedStickerId = equipped.sticker;
		selectedBackgroundId = equipped.background;
		selectedStickerId = equipped.sticker;
	}

	async function loadItems() {
		itemsLoading = true;
		const result = await telegramTrpc.telegram.inventory.myItems.query({ type });
		items = result.rows as Item[];
		itemsLoading = false;
	}

	async function renderPreview() {
		previewLoading = true;
		const result = await telegramTrpc.telegram.inventory.render.query({
			backgroundId: selectedBackgroundId ?? undefined,
			stickerId: selectedStickerId ?? undefined,
		});
		previewUrl = result?.url ?? null;
		previewLoading = false;
	}

	$effect(() => {
		type;
		loadItems();
	});

	$effect(() => {
		selectedBackgroundId;
		selectedStickerId;
		renderPreview();
	});

	loadEquipped();

	function selectItem(item: Item) {
		if (type === 'background') selectedBackgroundId = item.id;
		else selectedStickerId = item.id;
	}

	function isSelected(item: Item) {
		return type === 'background' ? selectedBackgroundId === item.id : selectedStickerId === item.id;
	}

	async function save() {
		saving = true;
		await telegramTrpc.telegram.inventory.save.mutate({
			backgroundId: selectedBackgroundId ?? undefined,
			stickerId: selectedStickerId ?? undefined,
		});
		equippedBackgroundId = selectedBackgroundId;
		equippedStickerId = selectedStickerId;
		saving = false;
	}
</script>

<Page class="pb-safe-24">
	<Navbar title="Inventário" />

	<Block>
		{#if previewUrl}
			<div
				class="aspect-3/2 w-full rounded-lg bg-cover bg-center"
				class:opacity-50={previewLoading}
				style={`background-image: url(${previewUrl})`}
			></div>
		{:else}
			<div class="flex aspect-3/2 w-full items-center justify-center rounded-lg bg-black/5 dark:bg-white/10">
				<Preloader />
			</div>
		{/if}
	</Block>

	<div class="p-4 pt-0">
		<Segmented strong>
			<SegmentedButton strong active={type === 'background'} onClick={() => (type = 'background')}>Meus papéis de parede</SegmentedButton>
			<SegmentedButton strong active={type === 'sticker'} onClick={() => (type = 'sticker')}>Meus stickers</SegmentedButton>
		</Segmented>
	</div>

	{#if itemsLoading}
		<div class="flex justify-center p-8"><Preloader /></div>
	{:else}
		<div class="grid grid-cols-2 gap-4 p-4">
			{#each items as item (item.id)}
				<button
					type="button"
					onclick={() => selectItem(item)}
					class="ios:rounded-2xl material:rounded-xl relative overflow-hidden border-2 bg-black/5 text-left transition-colors dark:bg-white/5 {isSelected(item) ? 'border-primary' : 'border-transparent'}"
				>
					<div class="aspect-3/1 bg-cover bg-center" style={`background-image: url(${item.itemURL})`}></div>
					<div class="p-2">
						<div class="truncate text-sm font-bold text-black dark:text-white">{item.title}</div>
						{#if item.id === (type === 'background' ? equippedBackgroundId : equippedStickerId)}
							<div class="text-xs text-black/55 dark:text-white/55">Equipado</div>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{/if}
</Page>

{#if dirty}
	<Toolbar class="left-0 bottom-safe-16 fixed z-20" innerClass="items-center">
		<div class="left">Você tem alterações não salvas</div>
		<div class="right">
			<Button rounded disabled={saving} onClick={save}>
				{#if saving}
					<Preloader colors={{ iconIos: 'text-white', iconMaterial: 'text-white' }} />
				{:else}
					Salvar
				{/if}
			</Button>
		</div>
	</Toolbar>
{/if}
