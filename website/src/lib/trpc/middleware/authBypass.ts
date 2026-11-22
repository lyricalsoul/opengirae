import { env } from '$env/dynamic/private';

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// the flag alone isn't enough: ORIGIN is mandatory in a real deployment (adapter-node) and is never localhost there, so a stray flag in prod stays inert.
export function authBypassEnabled(): boolean {
	return env.BYPASS_TELEGRAM_AUTH_DO_NOT_USE_THIS_IN_PROD_PRETTY_PLEASE === '1' && LOCAL_ORIGIN.test(env.ORIGIN ?? '');
}
