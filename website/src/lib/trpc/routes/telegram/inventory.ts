import { z } from 'zod';
import { telegramProcedure, requireUser } from '$lib/trpc/middleware/telegramAuth';
import { t } from '$lib/trpc/t';
import { VanitiesDB } from '@girae/database/vanities';
import { UsersDB } from '@girae/database/users';
import { MAX_BIO_LENGTH } from '@girae/database/constants';
import { renderProfile } from '@girae/common/ditto';

const typeInput = z.enum(['background', 'sticker']);
const hexColorInput = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida');

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

	myProfile: telegramProcedure.query(async ({ ctx }) => {
		const profileRow = await UsersDB.getUserProfileByTelegramId(ctx.tgUser.id.toString());
		return {
			bio: profileRow?.user_profiles?.bio ?? '',
			favoriteColor: profileRow?.user_profiles?.favoriteColor ?? '#000000',
		};
	}),

	render: telegramProcedure
		.input(z.object({
			backgroundId: z.number().int().positive().optional(),
			stickerId: z.number().int().positive().optional(),
			bio: z.string().max(MAX_BIO_LENGTH).optional(),
			favoriteColor: hexColorInput.optional(),
		}))
		.query(({ ctx, input }) => renderProfile(ctx.tgUser.id.toString(), input)),

	save: telegramProcedure
		.input(z.object({ backgroundId: z.number().int().positive().optional(), stickerId: z.number().int().positive().optional() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			if (input.backgroundId) await VanitiesDB.equipItem(user.id, 'background', input.backgroundId);
			if (input.stickerId) await VanitiesDB.equipItem(user.id, 'sticker', input.stickerId);
			return { ok: true };
		}),

	saveProfile: telegramProcedure
		.input(z.object({ bio: z.string().max(MAX_BIO_LENGTH).optional(), favoriteColor: hexColorInput.optional() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			await UsersDB.updateUserProfile(user.id, input);
			return { ok: true };
		}),
});
