import { authBypassEnabled } from '$lib/trpc/middleware/authBypass';

export function load() {
	return { authBypassed: authBypassEnabled() };
}
