import { t } from '$lib/trpc/t';
import { usersRouter } from '$lib/trpc/routes/users';
import { itemsRouter } from '$lib/trpc/routes/items';
import { statsRouter } from '$lib/trpc/routes/stats';
import { categoriesRouter } from '$lib/trpc/routes/categories';
import { cardsRouter } from '$lib/trpc/routes/cards';
import { raritiesRouter } from '$lib/trpc/routes/rarities';
import { auctionsRouter } from '$lib/trpc/routes/auctions';
import { telegramAuctionsRouter } from '$lib/trpc/routes/telegram/auctions';
import { telegramCardsRouter } from '$lib/trpc/routes/telegram/cards';
import { telegramStoreRouter } from '$lib/trpc/routes/telegram/store';
import { telegramInventoryRouter } from '$lib/trpc/routes/telegram/inventory';
import { telegramStorefrontRouter } from '$lib/trpc/routes/telegram/storefront';

import { promoCodesRouter } from '$lib/trpc/routes/promoCodes';
import { economyRouter } from '$lib/trpc/routes/economy';
import { settingsRouter } from '$lib/trpc/routes/settings';

export const router = t.router({
	users: usersRouter,
	items: itemsRouter,
	stats: statsRouter,
	categories: categoriesRouter,
	cards: cardsRouter,
	rarities: raritiesRouter,
	auctions: auctionsRouter,
    promoCodes: promoCodesRouter,
	economy: economyRouter,
	settings: settingsRouter,
	telegram: t.router({
		cards: telegramCardsRouter,
		store: telegramStoreRouter,
		inventory: telegramInventoryRouter,
		storefront: telegramStorefrontRouter,
		auctions: telegramAuctionsRouter,
	}),
});

export const createCaller = t.createCallerFactory(router);

export type Router = typeof router;
