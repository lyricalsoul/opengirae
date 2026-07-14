import { t } from '$lib/trpc/t';
import { adminProcedure } from '$lib/trpc/middleware/auth';
import { VanitiesDB } from '@girae/database/vanities';
import { z } from 'zod';

const storeItemType = z.enum(['background', 'sticker', 'profile']);

export const itemsRouter = t.router({
	list: adminProcedure.query(() => VanitiesDB.listAllStoreItems()),

	create: adminProcedure
		.input(
			z.object({
				title: z.string(),
				description: z.string(),
				type: storeItemType,
				price: z.number(),
				itemURL: z.string()
			})
		)
		.mutation(({ input }) => VanitiesDB.createStoreItem(input)),

	update: adminProcedure
		.input(
			z.object({
				id: z.number(),
				title: z.string().optional(),
				description: z.string().optional(),
				type: storeItemType.optional(),
				price: z.number().optional(),
				itemURL: z.string().optional(),
				isAvailable: z.boolean().optional(),
				isSearchable: z.boolean().optional()
			})
		)
		.mutation(({ input: { id, ...data } }) => VanitiesDB.updateStoreItem(id, data)),

	delete: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => VanitiesDB.deleteStoreItem(input.id))
});
