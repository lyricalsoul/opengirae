<script lang="ts">
	import { DropdownMenu } from 'bits-ui';

	let {
		isAvailable,
		onEdit,
		onToggleAvailable,
		onDelete
	}: {
		isAvailable: boolean;
		onEdit: () => void;
		onToggleAvailable: () => void;
		onDelete: () => void;
	} = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="border-line bg-panel text-ink-dim hover:text-ink hover:bg-bg-soft flex h-7 w-7 items-center justify-center rounded-lg border"
		aria-label="Ações"
		onclick={(e) => e.stopPropagation()}
	>
		⋮
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content class="menu-content" sideOffset={4} align="end">
			<DropdownMenu.Item onSelect={onEdit} class="menu-item">Editar</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={onToggleAvailable} class="menu-item">
				{isAvailable ? 'Ocultar' : 'Ativar'}
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={onDelete} class="menu-item menu-item-danger">Excluir</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
