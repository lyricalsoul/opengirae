import { t } from '$lib/trpc/t';
import { usersRouter } from '$lib/trpc/routes/users';
import { itemsRouter } from '$lib/trpc/routes/items';
import { statsRouter } from '$lib/trpc/routes/stats';

export const router = t.router({
	users: usersRouter,
	items: itemsRouter,
	stats: statsRouter
});

export const createCaller = t.createCallerFactory(router);

export type Router = typeof router;
