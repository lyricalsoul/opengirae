import { z } from 'zod';
import { telegramProcedure, requireUser } from '$lib/trpc/middleware/telegramAuth';
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

export const telegramStoreRouter = t.router({
	popular: telegramProcedure.input(pageInput).query(({ input }) =>
		VanitiesDB.listStoreItemsByPopularity(input.type, input)
	),

	recent: telegramProcedure.input(pageInput).query(({ input }) =>
		VanitiesDB.listStoreItemsByRecency(input.type, input)
	),

	cheapest: telegramProcedure.input(pageInput).query(({ input }) =>
		VanitiesDB.listStoreItemsByPrice(input.type, input)
	),

	search: telegramProcedure.input(pageInput).query(({ input }) =>
		VanitiesDB.listStoreItemsByRecency(input.type, input)
	),

	ownedItemIds: telegramProcedure.query(async ({ ctx }) => {
		const user = await requireUser(ctx.tgUser.id.toString());
		return VanitiesDB.getBoughtItemIds(user.id);
	}),

	equippedItemIds: telegramProcedure.query(async ({ ctx }) => {
		const profileRow = await UsersDB.getUserProfileByTelegramId(ctx.tgUser.id.toString());
		return {
			background: profileRow?.user_profiles?.equipedBackgroundId ?? null,
			sticker: profileRow?.user_profiles?.equipedStickerId ?? null,
		};
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
