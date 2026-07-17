<script lang="ts">
	import './admin.css';
	import { page, navigating } from '$app/state';
	import UserMenu from '$lib/components/UserMenu.svelte';
	import Toaster from '$lib/components/Toaster.svelte';

	let { children, data } = $props();

	const links = [
		{ href: '/admin/overview', label: 'Visão Geral' },
		{ href: '/admin/users', label: 'Usuários' },
		{ href: '/admin/items', label: 'Loja' },
		{ href: '/admin/categories', label: 'Categorias' },
		{ href: '/admin/subcategories', label: 'Subcategorias' },
		{ href: '/admin/cards', label: 'Cartas' }
	];
</script>

<div class="grain"></div>
<div class="bg-tint flex h-screen overflow-hidden">
	{#if data.user}
		<aside class="border-line bg-panel flex w-56 shrink-0 flex-col justify-between overflow-y-auto border-r px-5 py-6">
			<div>
				<div class="mb-8 flex items-center gap-2">
					<span class="text-ink text-lg font-bold">giraê</span>
					<span class="text-ink-dim border-line rounded-full border px-2 py-0.5 text-[10px] tracking-widest uppercase">
						admin
					</span>
				</div>

				<nav class="flex flex-col gap-1">
					{#each links as link (link.href)}
						<a
							href={link.href}
							class="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
							class:bg-bg-soft={page.url.pathname === link.href}
							class:text-magenta={page.url.pathname === link.href}
							class:text-ink-dim={page.url.pathname !== link.href}
						>
							{link.label}
						</a>
					{/each}
				</nav>
			</div>

			<UserMenu name={data.user.name} image={data.user.image} />
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<div class="h-0.5 shrink-0">
				{#if navigating.to}
					<div class="bg-magenta h-full w-full animate-pulse"></div>
				{/if}
			</div>
			<main class="min-w-0 flex-1 overflow-y-auto overflow-x-auto px-8 py-10">
				{@render children()}
			</main>
		</div>
	{:else}
		{@render children()}
	{/if}
</div>

<Toaster />
