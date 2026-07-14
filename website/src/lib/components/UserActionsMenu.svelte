<script lang="ts">
	import { DropdownMenu } from 'bits-ui';

	let {
		isBanned,
		isAdmin,
		onBan,
		onUnban,
		onToggleAdmin
	}: {
		isBanned: boolean;
		isAdmin: boolean;
		onBan: () => void;
		onUnban: () => void;
		onToggleAdmin: () => void;
	} = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="border-line text-ink-dim hover:text-ink hover:bg-bg-soft flex h-8 w-8 items-center justify-center rounded-lg border"
		aria-label="Ações"
	>
		⋮
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content class="menu-content" sideOffset={4} align="end">
			{#if isBanned}
				<DropdownMenu.Item onSelect={onUnban} class="menu-item">Desbanir</DropdownMenu.Item>
			{:else}
				<DropdownMenu.Item onSelect={onBan} class="menu-item menu-item-danger">Banir</DropdownMenu.Item>
			{/if}
			<DropdownMenu.Item onSelect={onToggleAdmin} class="menu-item">
				{isAdmin ? 'Remover admin' : 'Tornar admin'}
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
