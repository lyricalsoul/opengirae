import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.session && url.pathname !== '/admin/login') {
		redirect(302, '/admin/login');
	}

	return { user: locals.user };
};
