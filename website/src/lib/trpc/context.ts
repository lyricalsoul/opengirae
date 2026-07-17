import type { RequestEvent } from '@sveltejs/kit';

export async function createContext(event: RequestEvent) {
	return {
		session: event.locals.session,
		user: event.locals.user,
		tmaInitData: event.request.headers.get('x-tma-init-data'),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
