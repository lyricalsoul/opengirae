import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { telegramProcedure } from '$lib/trpc/middleware/telegramAuth';
import { t } from '$lib/trpc/t';
import { VanitiesDB } from '@girae/database/vanities';
import { UsersDB } from '@girae/database/users';
import { previewItem } from '@girae/common/ditto';

const typeInput = z.enum(['background', 'sticker']);
const pageInput = z.object({
	type: typeInput,
	query: z.string().optional(),
	limit: z.number().int().positive().max(100).optional(),
	offset: z.number().int().nonnegative().optional(),
});

async function requireUser(telegramId: string) {
	const user = await UsersDB.getUserByTelegramId(telegramId);
	if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
	return user;
}

export const telegramStoreRouter = t.router({
	popular: telegramProcedure.input(pageInput).query(({ input }) =>
		VanitiesDB.listStoreItemsByPopularity(input.type, input)
	),

	recent: telegramProcedure.input(pageInput).query(({ input }) =>
		VanitiesDB.listStoreItemsByRecency(input.type, input)
	),

	search: telegramProcedure.input(pageInput).query(({ input }) =>
		VanitiesDB.listStoreItemsByRecency(input.type, input)
	),

	ownedItemIds: telegramProcedure.query(async ({ ctx }) => {
		const user = await requireUser(ctx.tgUser.id.toString());
		return VanitiesDB.getBoughtItemIds(user.id);
	}),

	balance: telegramProcedure.query(async ({ ctx }) => {
		const user = await requireUser(ctx.tgUser.id.toString());
		return user.coins;
	}),

	preview: telegramProcedure
		.input(z.object({ itemId: z.number().int().positive() }))
		.query(({ ctx, input }) => previewItem(ctx.tgUser.id.toString(), input.itemId)),

	buy: telegramProcedure
		.input(z.object({ itemId: z.number().int().positive() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return VanitiesDB.buyItem(user.id, input.itemId);
		}),

	equip: telegramProcedure
		.input(z.object({ itemId: z.number().int().positive(), type: typeInput }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return VanitiesDB.equipItem(user.id, input.type, input.itemId);
		}),
});
