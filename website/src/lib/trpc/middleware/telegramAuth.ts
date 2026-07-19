import { t } from '$lib/trpc/t';
import { TRPCError } from '@trpc/server';
import { validate, parse } from '@tma.js/init-data-node';
import { env } from '$env/dynamic/private';
import { UsersDB } from '@girae/database/users';

export async function requireUser(telegramId: string) {
	const user = await UsersDB.getUserByPlatformAccount('telegram', telegramId);
	if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
	return user;
}

export const telegramProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.tmaInitData) throw new TRPCError({ code: 'UNAUTHORIZED' });
	if (!env.TELEGRAM_TOKEN) throw new Error('TELEGRAM_TOKEN is not set');

	let tgUser;
	try {
		validate(ctx.tmaInitData, env.TELEGRAM_TOKEN);
		tgUser = parse(ctx.tmaInitData).user;
	} catch {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}
	if (!tgUser) throw new TRPCError({ code: 'UNAUTHORIZED' });

	return next({ ctx: { ...ctx, tgUser } });
});
