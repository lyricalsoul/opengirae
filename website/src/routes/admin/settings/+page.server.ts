import { createCaller } from '$lib/trpc/router';
import { createContext } from '$lib/trpc/context';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const caller = createCaller(await createContext(event));
	const [state, economyState] = await Promise.all([caller.settings.get(), caller.economy.get()]);
	return { state, economyState };
};
