import { createCaller } from '$lib/trpc/router';
import { createContext } from '$lib/trpc/context';
import { CARD_DISCARD_REWARDS } from '@girae/database/constants';
import type { PageServerLoad } from './$types';

const DAILY_BASE_REWARD = 200;
const SAMPLE_STORE_PRICES = [100, 1000, 5000, 10000];

export const load: PageServerLoad = async (event) => {
	const state = await createCaller(await createContext(event)).economy.get();
	return {
		state,
		baseRates: {
			dailyBase: DAILY_BASE_REWARD,
			cardDiscardRewards: CARD_DISCARD_REWARDS,
			samplePrices: SAMPLE_STORE_PRICES,
		},
	};
};
