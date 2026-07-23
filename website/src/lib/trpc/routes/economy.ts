import { t } from '$lib/trpc/t';
import { z } from 'zod';
import { adminProcedure } from '$lib/trpc/middleware/auth';
import { EconomyDB } from '@girae/database/economy';

export const economyRouter = t.router({
	get: adminProcedure.query(() => EconomyDB.getState()),

	setInflationRate: adminProcedure
		.input(z.object({ rate: z.number().positive() }))
		.mutation(async ({ input }) => {
			await EconomyDB.setInflationRate(input.rate);
			return EconomyDB.getState();
		}),

	setIncomeInflationRate: adminProcedure
		.input(z.object({ rate: z.number().positive() }))
		.mutation(async ({ input }) => {
			await EconomyDB.setIncomeInflationRate(input.rate);
			return EconomyDB.getState();
		}),

	setTreasuryBalance: adminProcedure
		.input(z.object({ balance: z.number().int().nonnegative() }))
		.mutation(async ({ input }) => {
			await EconomyDB.setTreasuryBalance(input.balance);
			return EconomyDB.getState();
		}),
});
