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
			const profileRow = await UsersDB.getUserProfileByPlatformAccount('telegram', ctx.tgUser.id.toString());
			const equipped = UsersDB.getEquippedItemIds(profileRow?.user_profiles);
			const equippedId = input.type === 'background' ? equipped.background : equipped.sticker;
			return VanitiesDB.listOwnedStoreItems(user.id, input.type, { ...input, equippedId });
		}),

	myProfile: telegramProcedure.query(async ({ ctx }) => {
		const profileRow = await UsersDB.getUserProfileByPlatformAccount('telegram', ctx.tgUser.id.toString());
		return {
			bio: profileRow?.user_profiles?.bio ?? '',
			favoriteColor: profileRow?.user_profiles?.favoriteColor ?? '#000000',
			favoriteCardColor: profileRow?.user_profiles?.favoriteCardColor ?? null,
			hideEmojis: profileRow?.user_profiles?.hideProfileEmojis ?? false,
		};
	}),

	render: telegramProcedure
		.input(z.object({
			backgroundId: z.number().int().positive().optional(),
			stickerId: z.number().int().positive().optional(),
			bio: z.string().max(MAX_BIO_LENGTH).optional(),
			favoriteColor: hexColorInput.optional(),
			favoriteCardColor: hexColorInput.nullable().optional(),
			hideEmojis: z.boolean().optional(),
		}))
		.query(({ ctx, input }) => renderProfile('telegram', ctx.tgUser.id.toString(), input)),

	save: telegramProcedure
		.input(z.object({ backgroundId: z.number().int().positive().optional(), stickerId: z.number().int().positive().optional() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			if (input.backgroundId) await VanitiesDB.equipItem(user.id, 'background', input.backgroundId);
			if (input.stickerId) await VanitiesDB.equipItem(user.id, 'sticker', input.stickerId);
			return { ok: true };
		}),

	saveProfile: telegramProcedure
		.input(z.object({
			bio: z.string().max(MAX_BIO_LENGTH).optional(),
			favoriteColor: hexColorInput.optional(),
			favoriteCardColor: hexColorInput.nullable().optional(),
			hideEmojis: z.boolean().optional(),
		}))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			const { hideEmojis, ...rest } = input;
			await UsersDB.updateUserProfile(user.id, {
				...rest,
				...(hideEmojis !== undefined ? { hideProfileEmojis: hideEmojis } : {}),
			});
			return { ok: true };
		}),
});
