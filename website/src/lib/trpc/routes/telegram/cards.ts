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

const viewingInput = listInput.extend({ targetUserId: z.number().int().positive().optional() });

async function resolveViewSubject(ctx: { tgUser: { id: number } }, targetUserId: number | undefined) {
	const user = await requireUser(ctx.tgUser.id.toString());
	if (!targetUserId || targetUserId === user.id) return user;

	const target = await UsersDB.getUserById(targetUserId);
	if (!target) throw new TRPCError({ code: 'NOT_FOUND' });
	if (!UsersDB.isViewable(user.id, target)) throw new TRPCError({ code: 'FORBIDDEN' });
	return target;
}

export const telegramCardsRouter = t.router({
	targetInfo: telegramProcedure
		.input(z.object({ targetUserId: z.number().int().positive() }))
		.query(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			const target = await UsersDB.getUserById(input.targetUserId);
			if (!target) throw new TRPCError({ code: 'NOT_FOUND' });
			return {
				displayName: target.displayName,
				isSelf: target.id === user.id,
				viewable: UsersDB.isViewable(user.id, target),
			};
		}),

	bySubcategory: telegramProcedure.input(viewingInput).query(async ({ ctx, input }) => {
		const { targetUserId, ...opts } = input;
		const subject = await resolveViewSubject(ctx, targetUserId);
		return CardsDB.getUserOwnedCardsBySubcategory(subject.id, opts);
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

	wishlist: telegramProcedure.input(viewingInput).query(async ({ ctx, input }) => {
		const { targetUserId, ...opts } = input;
		const subject = await resolveViewSubject(ctx, targetUserId);
		return CardsDB.getWishlist(subject.id, opts);
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
