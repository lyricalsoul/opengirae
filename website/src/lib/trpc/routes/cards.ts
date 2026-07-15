import { t } from '$lib/trpc/t';
import { adminProcedure } from '$lib/trpc/middleware/auth';
import { CardsDB } from '@girae/database/cards';
import { z } from 'zod';

export const cardsRouter = t.router({
	list: adminProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).default(20),
				offset: z.number().min(0).default(0),
				query: z.string().optional(),
				sortField: z.enum(['name', 'rarityModifier']).optional(),
				sortDir: z.enum(['asc', 'desc']).optional()
			})
		)
		.query(({ input }) => CardsDB.listCardsForAdmin(input)),

	rarities: adminProcedure.query(() => CardsDB.getRarities()),

	get: adminProcedure.input(z.object({ id: z.number() })).query(({ input }) => CardsDB.getCardForAdminEdit(input.id)),

	create: adminProcedure
		.input(
			z.object({
				name: z.string(),
				imageUrl: z.string(),
				rarityId: z.number(),
				subcategoryId: z.number(),
				secondarySubcategoryIds: z.array(z.number()).default([])
			})
		)
		.mutation(({ input }) =>
			CardsDB.createCard(input.name, input.rarityId, input.imageUrl, input.subcategoryId, input.secondarySubcategoryIds)
		),

	update: adminProcedure
		.input(
			z.object({
				id: z.number(),
				name: z.string().optional(),
				imageUrl: z.string().optional(),
				rarityId: z.number().optional(),
				rarityModifier: z.number().optional()
			})
		)
		.mutation(({ input: { id, ...data } }) => CardsDB.updateCard(id, data)),

	updateSubcategories: adminProcedure
		.input(z.object({ id: z.number(), subcategoryId: z.number(), secondarySubcategoryIds: z.array(z.number()).default([]) }))
		.mutation(({ input }) => CardsDB.setCardSubcategories(input.id, input.subcategoryId, input.secondarySubcategoryIds)),

	delete: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => CardsDB.deleteCardGuarded(input.id)),

	forceDelete: adminProcedure
		.input(z.object({ id: z.number() }))
		.mutation(({ input }) => CardsDB.forceDeleteCard(input.id))
});
