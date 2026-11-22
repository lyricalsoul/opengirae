// one ticking "now" per component instead of each re-declaring its own setInterval; call during component init (it registers an $effect).
export function createClock(intervalMs = 1000) {
	let now = $state(Date.now());
	$effect(() => {
		const interval = setInterval(() => (now = Date.now()), intervalMs);
		return () => clearInterval(interval);
	});
	return {
		get now() {
			return now;
		},
	};
}
