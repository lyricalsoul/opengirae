import { t } from '$lib/trpc/t';
import { TRPCError } from '@trpc/server';
import { validate, parse } from '@tma.js/init-data-node';

export const telegramProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.tmaInitData) throw new TRPCError({ code: 'UNAUTHORIZED' });

	let tgUser;
	try {
		validate(ctx.tmaInitData, process.env.TELEGRAM_TOKEN!);
		tgUser = parse(ctx.tmaInitData).user;
	} catch {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}
	if (!tgUser) throw new TRPCError({ code: 'UNAUTHORIZED' });

	return next({ ctx: { ...ctx, tgUser } });
});
