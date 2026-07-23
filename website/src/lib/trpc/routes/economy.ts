import { t } from '$lib/trpc/t';
import { z } from 'zod';
import { adminProcedure } from '$lib/trpc/middleware/auth';
import { EconomyDB } from '@girae/database/economy';
import { AllocationId } from '@girae/database/schemas/economy';

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

	listAllocations: adminProcedure.query(() => EconomyDB.listAllocations()),

	updateAllocation: adminProcedure
		.input(z.object({ allocationId: z.nativeEnum(AllocationId), name: z.string().min(1), percentage: z.number().min(0).max(100) }))
		.mutation(async ({ input }) => {
			const result = await EconomyDB.setAllocationConfig(input.allocationId, { name: input.name, percentage: input.percentage });
			if (!result.ok) throw new Error('A soma das porcentagens não pode passar de 100%.');
			return EconomyDB.listAllocations();
		}),

	syncAllocationsNow: adminProcedure.mutation(async () => {
		await EconomyDB.syncAllocations();
		return EconomyDB.listAllocations();
	}),
});
