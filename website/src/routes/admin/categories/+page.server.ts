import { createCaller } from '$lib/trpc/router';
import { createContext } from '$lib/trpc/context';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const categories = await createCaller(await createContext(event)).categories.list();
	return { categories };
};
