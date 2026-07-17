import { dev } from '$app/environment';

export function installDevConsoleForward() {
	if (!dev || typeof window === 'undefined') return;
	if ((window as any).__devConsoleForwardInstalled) return;
	(window as any).__devConsoleForwardInstalled = true;

	const send = (level: string, args: unknown[]) => {
		fetch('/api/devlog', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ level, args: args.map(String) }),
		}).catch(() => {});
	};

	for (const level of ['log', 'warn', 'error'] as const) {
		const original = console[level].bind(console);
		console[level] = (...args: unknown[]) => {
			original(...args);
			send(level, args);
		};
	}

	window.addEventListener('error', (e) => send('error', [`Uncaught: ${e.message}`, e.error?.stack ?? '']));
	window.addEventListener('unhandledrejection', (e) => send('error', [`Unhandled rejection: ${e.reason}`]));
}
