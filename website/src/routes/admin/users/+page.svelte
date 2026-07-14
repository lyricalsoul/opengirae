<script lang="ts">
	import UsersGrid from '$lib/components/UsersGrid.svelte';

	let { data } = $props();
</script>

<h1 class="text-ink mb-6 text-2xl font-bold">Usuários</h1>

<UsersGrid users={data.users} />
