<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		children,
		footer
	}: { open?: boolean; title: string; children: Snippet; footer?: Snippet } = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
		<Dialog.Content
			class="border-line bg-panel fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border p-5"
		>
			<Dialog.Title class="text-ink mb-4 shrink-0 text-sm font-semibold">{title}</Dialog.Title>
			<div class="overflow-y-auto">
				{@render children()}
			</div>
			{#if footer}
				<div class="shrink-0 pt-4">
					{@render footer()}
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
