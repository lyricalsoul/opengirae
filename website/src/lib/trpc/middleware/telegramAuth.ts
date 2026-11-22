import { t } from '$lib/trpc/t';
import { TRPCError } from '@trpc/server';
import { validate, parse } from '@tma.js/init-data-node';
import { env } from '$env/dynamic/private';
import { authBypassEnabled } from './authBypass';
import { UsersDB } from '@girae/database/users';

export async function requireUser(telegramId: string) {
	const user = await UsersDB.getUserByPlatformAccount('telegram', telegramId);
	if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
	return user;
}

function resolveTgUser(initData: string | null): { id: number } | undefined {
	if (!initData) return undefined;
	if (!env.TELEGRAM_TOKEN) throw new Error('TELEGRAM_TOKEN is not set');
	try {
		validate(initData, env.TELEGRAM_TOKEN);
		return parse(initData).user;
	} catch {
		return undefined;
	}
}

const DEV_BYPASS_TELEGRAM_ID = 1889562226;

export const telegramProcedure = t.procedure.use(({ ctx, next }) => {
	const tgUser = resolveTgUser(ctx.tmaInitData) ?? (authBypassEnabled() ? { id: DEV_BYPASS_TELEGRAM_ID } : undefined);
	if (!tgUser) throw new TRPCError({ code: 'UNAUTHORIZED' });

	return next({ ctx: { ...ctx, tgUser } });
});
