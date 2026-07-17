import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { telegramProcedure, requireUser } from '$lib/trpc/middleware/telegramAuth';
import { t } from '$lib/trpc/t';
import { CardsDB } from '@girae/database/cards';
import { UsersDB } from '@girae/database/users';

const listInput = z.object({
	query: z.string().optional(),
	limit: z.number().int().positive().max(100).optional(),
	offset: z.number().int().nonnegative().optional(),
});

export const telegramCardsRouter = t.router({
	bySubcategory: telegramProcedure.input(listInput).query(async ({ ctx, input }) => {
		const user = await requireUser(ctx.tgUser.id.toString());
		return CardsDB.getUserOwnedCardsBySubcategory(user.id, input);
	}),

	overview: telegramProcedure
		.input(listInput.extend({
			sortBy: z.enum(['default', 'closest']).optional(),
			completionFilter: z.enum(['all', 'incomplete', 'completed']).optional(),
		}))
		.query(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return CardsDB.getUserCollectionProgress(user.id, input);
		}),

	collectionStats: telegramProcedure.query(async ({ ctx }) => {
		const user = await requireUser(ctx.tgUser.id.toString());
		return CardsDB.getUserCollectionStats(user.id);
	}),

	discard: telegramProcedure
		.input(z.object({ cardId: z.number().int().positive() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return CardsDB.discardUserCard(user.id, input.cardId);
		}),

	discardMany: telegramProcedure
		.input(z.object({ cardIds: z.array(z.number().int().positive()).min(1) }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return CardsDB.discardUserCards(user.id, input.cardIds);
		}),

	myFavoriteCardId: telegramProcedure.query(async ({ ctx }) => {
		const user = await requireUser(ctx.tgUser.id.toString());
		return user.favoriteCardId;
	}),

	setFavorite: telegramProcedure
		.input(z.object({ cardId: z.number().int().positive() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			if (!(await CardsDB.hasUserCard(user.id, input.cardId))) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'not_owned' });
			}
			await UsersDB.setFavoriteCard(user.id, input.cardId);
			return { ok: true };
		}),

	subcategoryCards: telegramProcedure
		.input(z.object({
			subcategoryId: z.number().int().positive(),
			ownedFilter: z.enum(['owned', 'missing']).optional(),
			limit: z.number().int().positive().max(100).optional(),
			offset: z.number().int().nonnegative().optional(),
		}))
		.query(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			const { subcategoryId, ...opts } = input;
			return CardsDB.getCardsInSubcategoryForUserPaginated(subcategoryId, user.id, opts);
		}),
});
