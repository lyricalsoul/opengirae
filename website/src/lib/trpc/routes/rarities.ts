import { t } from '$lib/trpc/t';
import { adminProcedure } from '$lib/trpc/middleware/auth';
import { CardsDB } from '@girae/database/cards';
import { z } from 'zod';

export const raritiesRouter = t.router({
	list: adminProcedure.query(() => CardsDB.getRarities()),

	update: adminProcedure
		.input(
			z.object({
				id: z.number(),
				name: z.string().optional(),
				emoji: z.string().optional(),
				weight: z.number().optional(),
				cativeiroThreshold: z.number().optional()
			})
		)
		.mutation(({ input: { id, ...data } }) => CardsDB.updateRarity(id, data))
});
