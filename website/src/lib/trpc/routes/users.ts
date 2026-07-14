import { t } from '$lib/trpc/t';
import { adminProcedure } from '$lib/trpc/middleware/auth';
import { UsersDB } from '@girae/database/users';
import { z } from 'zod';

export const usersRouter = t.router({
	list: adminProcedure
		.input(z.object({ limit: z.number().min(1).max(200).default(50), offset: z.number().min(0).default(0), query: z.string().optional() }))
		.query(({ input }) => UsersDB.listUsers(input)),

	setBanned: adminProcedure
		.input(z.object({ userId: z.number(), isBanned: z.boolean(), banMessage: z.string().optional() }))
		.mutation(({ input }) => UsersDB.setBanned(input.userId, input.isBanned, input.banMessage)),

	setIsAdmin: adminProcedure
		.input(z.object({ userId: z.number(), isAdmin: z.boolean() }))
		.mutation(({ input }) => UsersDB.setIsAdmin(input.userId, input.isAdmin))
});
