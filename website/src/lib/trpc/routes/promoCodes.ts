import { t } from '$lib/trpc/t';
import { z } from 'zod';
import { adminProcedure } from '$lib/trpc/middleware/auth';
import { db } from '@girae/database';
import { promoCodes, promoCodeRedemptions, PromoRewardType } from '@girae/database/schemas/promo';
import { eq, sql } from 'drizzle-orm';

function generateRandomCode(length: number = 6): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

let cachedBotUsername: string | null = null;
async function getBotUsername(): Promise<string> {
    if (cachedBotUsername) return cachedBotUsername;
    try {
        const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/getMe`);
        const json = await res.json();
        cachedBotUsername = json.result.username;
        return cachedBotUsername!;
    } catch {
        return 'GiraeBot';
    }
}

export const promoCodesRouter = t.router({
	list: adminProcedure.query(async () => {
		const codes = await db
            .select({
                id: promoCodes.id,
                code: promoCodes.code,
                rewards: promoCodes.rewards,
                expiresAt: promoCodes.expiresAt,
                createdAt: promoCodes.createdAt,
                maxUses: promoCodes.maxUses,
                redemptions: sql<number>`cast(count(${promoCodeRedemptions.id}) as integer)`
            })
            .from(promoCodes)
            .leftJoin(promoCodeRedemptions, eq(promoCodes.id, promoCodeRedemptions.promoCodeId))
            .groupBy(promoCodes.id)
            .orderBy(promoCodes.createdAt);
        
        const botUsername = await getBotUsername();
		return { codes, botUsername };
	}),

	create: adminProcedure
		.input(z.object({
			rewards: z.record(z.nativeEnum(PromoRewardType), z.number()),
			expiresAt: z.string(),
			maxUses: z.number().nullable().optional()
		}))
		.mutation(async ({ input }) => {
			const codeStr = generateRandomCode(6);
			await db.insert(promoCodes).values({
				code: codeStr,
				rewards: input.rewards,
				expiresAt: new Date(input.expiresAt),
				maxUses: input.maxUses ?? null
			});
            const botUsername = await getBotUsername();
			return { code: codeStr, botUsername };
		}),

	update: adminProcedure
		.input(z.object({
			id: z.number(),
			rewards: z.record(z.nativeEnum(PromoRewardType), z.number()),
			expiresAt: z.string(),
			maxUses: z.number().nullable().optional()
		}))
		.mutation(async ({ input }) => {
			await db.update(promoCodes).set({
				rewards: input.rewards,
				expiresAt: new Date(input.expiresAt),
				maxUses: input.maxUses ?? null
			}).where(eq(promoCodes.id, input.id));
			return true;
		}),

	delete: adminProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ input }) => {
            await db.delete(promoCodeRedemptions).where(eq(promoCodeRedemptions.promoCodeId, input.id));
			await db.delete(promoCodes).where(eq(promoCodes.id, input.id));
			return true;
		}),
});
