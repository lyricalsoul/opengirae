<script lang="ts">
	import { Page, Navbar, Block, Segmented, SegmentedButton, Preloader, Toolbar, Button, ListInput } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import { MAX_BIO_LENGTH } from '@girae/database/constants';

	type Item = { id: number; title: string; description: string; price: number; itemURL: string; type: 'background' | 'sticker' };
	type Section = 'background' | 'sticker' | 'profile';

	let section = $state<Section>('background');
	let items = $state<Item[]>([]);
	let itemsLoading = $state(false);

	let equippedBackgroundId = $state<number | null>(null);
	let equippedStickerId = $state<number | null>(null);
	let selectedBackgroundId = $state<number | null>(null);
	let selectedStickerId = $state<number | null>(null);

	let savedBio = $state('');
	let savedFavoriteColor = $state('#000000');
	let bio = $state('');
	let favoriteColor = $state('#000000');
	let hexDraft = $state('#000000');

	let previewUrl = $state<string | null>(null);
	let previewLoading = $state(false);
	let saving = $state(false);
	let ready = $state(false);

	let dirty = $derived(
		selectedBackgroundId !== equippedBackgroundId
		|| selectedStickerId !== equippedStickerId
		|| bio !== savedBio
		|| favoriteColor !== savedFavoriteColor,
	);

	async function init() {
		const [equipped, profile] = await Promise.all([
			telegramTrpc.telegram.store.equippedItemIds.query(),
			telegramTrpc.telegram.inventory.myProfile.query(),
		]);
		equippedBackgroundId = equipped.background;
		equippedStickerId = equipped.sticker;
		selectedBackgroundId = equipped.background;
		selectedStickerId = equipped.sticker;
		savedBio = profile.bio;
		savedFavoriteColor = profile.favoriteColor;
		bio = profile.bio;
		favoriteColor = profile.favoriteColor;
		hexDraft = profile.favoriteColor;
		ready = true;
		renderPreview();
	}

	async function loadItems() {
		if (section === 'profile') return;
		itemsLoading = true;
		const result = await telegramTrpc.telegram.inventory.myItems.query({ type: section });
		items = result.rows as Item[];
		itemsLoading = false;
	}

	async function renderPreview() {
		previewLoading = true;
		const result = await telegramTrpc.telegram.inventory.render.query({
			backgroundId: selectedBackgroundId ?? undefined,
			stickerId: selectedStickerId ?? undefined,
			bio,
			favoriteColor,
		});
		previewUrl = result?.url ?? null;
		previewLoading = false;
	}

	$effect(() => {
		section;
		loadItems();
	});

	// debounced: bio is typed continuously, unlike picking a background/sticker
	let previewDebounce: ReturnType<typeof setTimeout>;
	$effect(() => {
		selectedBackgroundId;
		selectedStickerId;
		bio;
		favoriteColor;
		if (!ready) return;
		clearTimeout(previewDebounce);
		previewDebounce = setTimeout(renderPreview, 400);
	});

	init();

	function selectItem(item: Item) {
		if (section === 'background') selectedBackgroundId = item.id;
		else if (section === 'sticker') selectedStickerId = item.id;
	}

	function isSelected(item: Item) {
		return section === 'background' ? selectedBackgroundId === item.id : selectedStickerId === item.id;
	}

	function onHexInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		hexDraft = value;
		if (/^#[0-9a-fA-F]{6}$/.test(value)) favoriteColor = value;
	}

	function onColorPicked(e: Event) {
		favoriteColor = (e.target as HTMLInputElement).value;
		hexDraft = favoriteColor;
	}

	async function save() {
		saving = true;
		await Promise.all([
			selectedBackgroundId !== equippedBackgroundId || selectedStickerId !== equippedStickerId
				? telegramTrpc.telegram.inventory.save.mutate({
					backgroundId: selectedBackgroundId ?? undefined,
					stickerId: selectedStickerId ?? undefined,
				})
				: null,
			bio !== savedBio || favoriteColor !== savedFavoriteColor
				? telegramTrpc.telegram.inventory.saveProfile.mutate({ bio, favoriteColor })
				: null,
		]);
		equippedBackgroundId = selectedBackgroundId;
		equippedStickerId = selectedStickerId;
		savedBio = bio;
		savedFavoriteColor = favoriteColor;
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
			<SegmentedButton strong active={section === 'background'} onClick={() => (section = 'background')}>Backgrounds</SegmentedButton>
			<SegmentedButton strong active={section === 'sticker'} onClick={() => (section = 'sticker')}>Stickers</SegmentedButton>
			<SegmentedButton strong active={section === 'profile'} onClick={() => (section = 'profile')}>Perfil</SegmentedButton>
		</Segmented>
	</div>

	{#if section === 'profile'}
		<Block strong outline>
			<ListInput
				type="textarea"
				label="Biografia"
				placeholder="Fale um pouco sobre você..."
				maxlength={MAX_BIO_LENGTH}
				bind:value={bio}
				info={`${bio.length}/${MAX_BIO_LENGTH}`}
			/>
			<div class="mt-4 flex items-center gap-3">
				<input type="color" value={favoriteColor} oninput={onColorPicked} class="h-10 w-10 shrink-0 rounded-lg border border-black/10 dark:border-white/15" />
				<div class="flex-1">
					<ListInput label="Cor favorita" placeholder="#rrggbb" value={hexDraft} oninput={onHexInput} />
				</div>
			</div>
		</Block>
	{:else if itemsLoading}
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
						{#if item.id === (section === 'background' ? equippedBackgroundId : equippedStickerId)}
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
