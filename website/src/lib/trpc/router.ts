import { t } from '$lib/trpc/t';
import { usersRouter } from '$lib/trpc/routes/users';
import { itemsRouter } from '$lib/trpc/routes/items';
import { statsRouter } from '$lib/trpc/routes/stats';
import { categoriesRouter } from '$lib/trpc/routes/categories';
import { cardsRouter } from '$lib/trpc/routes/cards';

export const router = t.router({
	users: usersRouter,
	items: itemsRouter,
	stats: statsRouter,
	categories: categoriesRouter,
	cards: cardsRouter
});

export const createCaller = t.createCallerFactory(router);

export type Router = typeof router;
