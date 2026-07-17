import { z } from 'zod';
import { telegramProcedure, requireUser } from '$lib/trpc/middleware/telegramAuth';
import { t } from '$lib/trpc/t';
import { VanitiesDB } from '@girae/database/vanities';
import { UsersDB } from '@girae/database/users';
import { renderProfile } from '@girae/common/ditto';

const typeInput = z.enum(['background', 'sticker']);

export const telegramInventoryRouter = t.router({
	myItems: telegramProcedure
		.input(z.object({ type: typeInput, limit: z.number().int().positive().max(100).optional(), offset: z.number().int().nonnegative().optional() }))
		.query(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			const profileRow = await UsersDB.getUserProfileByTelegramId(ctx.tgUser.id.toString());
			const equippedId = input.type === 'background'
				? profileRow?.user_profiles?.equipedBackgroundId
				: profileRow?.user_profiles?.equipedStickerId;
			return VanitiesDB.listOwnedStoreItems(user.id, input.type, { ...input, equippedId });
		}),

	render: telegramProcedure
		.input(z.object({ backgroundId: z.number().int().positive().optional(), stickerId: z.number().int().positive().optional() }))
		.query(({ ctx, input }) => renderProfile(ctx.tgUser.id.toString(), input)),

	save: telegramProcedure
		.input(z.object({ backgroundId: z.number().int().positive().optional(), stickerId: z.number().int().positive().optional() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			if (input.backgroundId) await VanitiesDB.equipItem(user.id, 'background', input.backgroundId);
			if (input.stickerId) await VanitiesDB.equipItem(user.id, 'sticker', input.stickerId);
			return { ok: true };
		}),
});
