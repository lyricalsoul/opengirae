import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { telegramProcedure } from '$lib/trpc/middleware/telegramAuth';
import { t } from '$lib/trpc/t';
import { CardsDB } from '@girae/database/cards';
import { UsersDB } from '@girae/database/users';

const listInput = z.object({
	query: z.string().optional(),
	limit: z.number().int().positive().max(100).optional(),
	offset: z.number().int().nonnegative().optional(),
});

async function requireUser(telegramId: string) {
	const user = await UsersDB.getUserByTelegramId(telegramId);
	if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
	return user;
}

export const telegramCardsRouter = t.router({
	list: telegramProcedure.input(listInput).query(async ({ ctx, input }) => {
		const user = await requireUser(ctx.tgUser.id.toString());
		return CardsDB.getUserOwnedCardsPaginated(user.id, input);
	}),

	overview: telegramProcedure.input(listInput).query(async ({ ctx, input }) => {
		const user = await requireUser(ctx.tgUser.id.toString());
		return CardsDB.getUserCollectionProgress(user.id, input);
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

	subcategoryCards: telegramProcedure
		.input(z.object({ subcategoryId: z.number().int().positive() }))
		.query(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return CardsDB.getCardsInSubcategoryForUser(input.subcategoryId, user.id);
		}),
});
