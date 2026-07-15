import { createCaller } from '$lib/trpc/router';
import { createContext } from '$lib/trpc/context';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(await createContext(event));
	const [rarities, categories] = await Promise.all([caller.cards.rarities(), caller.categories.list()]);
	return { rarities, categories };
};
