<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { authClient } from '$lib/client/auth-client';
	import { goto } from '$app/navigation';

	let { name, image }: { name: string; image?: string | null } = $props();
	let broken = $state(false);
	let initials = $derived(name.slice(0, 2).toUpperCase());

	async function signOut() {
		await authClient.signOut();
		await goto('/admin/login');
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="border-line hover:bg-bg-soft flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left"
	>
		{#if image && !broken}
			<img
				src={image}
				alt=""
				width="28"
				height="28"
				class="shrink-0 rounded-full object-cover"
				onerror={() => (broken = true)}
			/>
		{:else}
			<div
				class="bg-bg-soft text-ink-dim flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
			>
				{initials}
			</div>
		{/if}
		<span class="text-ink truncate text-sm font-medium">{name}</span>
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content class="menu-content" sideOffset={4}>
			<DropdownMenu.Item onSelect={signOut} class="menu-item menu-item-danger">Sair</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
