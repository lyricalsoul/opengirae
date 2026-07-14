<script lang="ts">
	import { authClient } from '$lib/client/auth-client';
	import Button from '$lib/components/Button.svelte';

	function signIn() {
		authClient.signIn.oauth2({ providerId: 'oidc', callbackURL: '/admin' });
	}
</script>

<div class="bg-tint flex min-h-screen items-center px-10 md:px-20">
	<div class="max-w-xs">
		<p class="text-ink-dim mb-6 text-xs tracking-wide">boas-vindas à giraê</p>

		<Button onclick={signIn}>Entrar</Button>
	</div>
</div>
