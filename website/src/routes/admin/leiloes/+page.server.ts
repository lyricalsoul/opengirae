import { createCaller } from '$lib/trpc/router';
import { createContext } from '$lib/trpc/context';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const auctions = await createCaller(await createContext(event)).auctions.list({ limit: 50 });
	return { auctions };
};
