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
		.input(z.object({ cardId: z.number().int().positive(), quantity: z.number().int().positive().max(999).optional() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			const quantity = input.quantity ?? 1;
			const result = await CardsDB.discardUserCards(user.id, Array(quantity).fill(input.cardId));
			if (!result.ok) return null;
			const entry = result.results[0]!;
			return { remainingCount: entry.remainingCount, coinsAwarded: entry.coinsAwarded };
		}),

	discardMany: telegramProcedure
		.input(z.object({ cardIds: z.array(z.number().int().positive()).min(1).max(500) }))
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

	wishlist: telegramProcedure.input(listInput).query(async ({ ctx, input }) => {
		const user = await requireUser(ctx.tgUser.id.toString());
		return CardsDB.getWishlist(user.id, input);
	}),

	cardSearch: telegramProcedure.input(listInput).query(async ({ input }) => {
		return CardsDB.searchAllCardsPaginated(input);
	}),

	wishlistStatus: telegramProcedure
		.input(z.object({ cardId: z.number().int().positive() }))
		.query(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return CardsDB.isOnWishlist(user.id, input.cardId);
		}),

	wishlistAdd: telegramProcedure
		.input(z.object({ cardId: z.number().int().positive() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			await CardsDB.addToWishlist(user.id, input.cardId);
			return { ok: true };
		}),

	wishlistRemove: telegramProcedure
		.input(z.object({ cardId: z.number().int().positive() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			await CardsDB.removeFromWishlist(user.id, input.cardId);
			return { ok: true };
		}),

	goalStatus: telegramProcedure
		.input(z.object({ subcategoryId: z.number().int().positive() }))
		.query(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return CardsDB.isOnGoals(user.id, input.subcategoryId);
		}),

	goalAdd: telegramProcedure
		.input(z.object({ subcategoryId: z.number().int().positive() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			await CardsDB.addToGoals(user.id, input.subcategoryId);
			return { ok: true };
		}),

	goalRemove: telegramProcedure
		.input(z.object({ subcategoryId: z.number().int().positive() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			await CardsDB.removeFromGoals(user.id, input.subcategoryId);
			return { ok: true };
		}),

	wishlistReorder: telegramProcedure
		.input(z.object({ cardIds: z.array(z.number().int().positive()).min(1).max(200) }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			await CardsDB.reorderWishlist(user.id, input.cardIds);
			return { ok: true };
		}),

	tradableStatus: telegramProcedure
		.input(z.object({ cardId: z.number().int().positive() }))
		.query(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return CardsDB.isCardTradable(user.id, input.cardId);
		}),

	setTradable: telegramProcedure
		.input(z.object({ cardId: z.number().int().positive(), tradable: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			if (!(await CardsDB.hasUserCard(user.id, input.cardId))) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'not_owned' });
			}
			await CardsDB.setCardTradable(user.id, input.cardId, input.tradable);
			return { ok: true };
		}),
});
