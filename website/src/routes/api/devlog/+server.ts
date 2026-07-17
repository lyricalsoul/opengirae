import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	if (!dev) return json({ ok: false }, { status: 404 });

	const { level, args } = await request.json();
	const prefix = '[browser]';
	const line = args.map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

	if (level === 'error') console.error(prefix, line);
	else if (level === 'warn') console.warn(prefix, line);
	else console.log(prefix, line);

	return json({ ok: true });
};
