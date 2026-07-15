<script lang="ts">
	import { Combobox } from 'bits-ui';
	import { trpc } from '$lib/trpc/client';

	let {
		selected = $bindable([]),
		excludeId = null
	}: { selected: number[]; excludeId?: number | null } = $props();

	type Result = { id: number; name: string; categoryEmoji: string };

	let query = $state('');
	let results = $state<Result[]>([]);
	let labels = $state<Record<number, string>>({});
	let stringValue = $state<string[]>(selected.map(String));

	// keeps the combobox's own value in sync with the bindable `selected` prop in both directions
	$effect(() => {
		const next = selected.map(String);
		if (next.join(',') !== stringValue.join(',')) stringValue = next;
	});
	$effect(() => {
		const next = stringValue.map(Number);
		if (next.join(',') !== selected.join(',')) selected = next;
	});

	let debounceHandle: ReturnType<typeof setTimeout>;
	$effect(() => {
		const q = query;
		clearTimeout(debounceHandle);
		if (!q) {
			results = [];
			return;
		}
		debounceHandle = setTimeout(async () => {
			const rows = await trpc().categories.searchSubcategories.query({ query: q, limit: 20 });
			results = rows.filter((r) => r.id !== excludeId);
			for (const r of rows) labels[r.id] = r.name;
		}, 250);
	});

	// hydrate labels for ids selected before any search happened (e.g. opening the edit form)
	$effect(() => {
		for (const id of selected) {
			if (labels[id]) continue;
			trpc()
				.categories.subcategory.query({ id })
				.then((row) => {
					if (row) labels[id] = row.name;
				});
		}
	});

	function remove(id: number) {
		selected = selected.filter((s) => s !== id);
	}
</script>

<div>
	{#if selected.length > 0}
		<div class="mb-2 flex flex-wrap gap-1">
			{#each selected as id (id)}
				<span class="border-line bg-bg-soft flex items-center gap-1 rounded-full border px-2 py-1 text-xs">
					{labels[id] ?? `#${id}`}
					<button type="button" onclick={() => remove(id)} class="text-ink-dim hover:text-ink" aria-label="Remover">
						×
					</button>
				</span>
			{/each}
		</div>
	{/if}

	<Combobox.Root type="multiple" bind:value={stringValue} items={results.map((r) => ({ value: String(r.id), label: r.name }))}>
		<Combobox.Input bind:value={query} placeholder="Buscar subcategoria…" class="field" />
		<Combobox.Portal>
			<Combobox.Content class="menu-content max-h-60 overflow-y-auto" sideOffset={4}>
				{#each results as r (r.id)}
					<Combobox.Item value={String(r.id)} label={r.name} class="menu-item flex items-center justify-between">
						<span>{r.name} {r.categoryEmoji}</span>
					</Combobox.Item>
				{:else}
					<p class="text-ink-dim px-3 py-2 text-xs">{query ? 'Nenhum resultado' : 'Digite para buscar'}</p>
				{/each}
			</Combobox.Content>
		</Combobox.Portal>
	</Combobox.Root>
</div>
