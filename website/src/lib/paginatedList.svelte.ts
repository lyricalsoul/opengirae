
export function createPaginatedList<T, R extends { rows: T[]; total: number }>(
	fetcher: (offset: number) => Promise<R>,
	onResult?: (result: R) => void,
) {
	let items = $state<T[]>([]);
	let total = $state(0);
	let offset = $state(0);
	let loading = $state(false);

	let resetLoading = $state(false);
	let error = $state<unknown>(null);
	let requestId = 0;

	async function load(reset: boolean) {
		if (!reset && loading) return;
		const id = ++requestId;
		loading = true;
		if (reset) resetLoading = true;
		const nextOffset = reset ? 0 : offset;
		error = null;
		try {
			const result = await fetcher(nextOffset);
			if (id !== requestId) return;
			items = reset ? result.rows : [...items, ...result.rows];
			total = result.total;
			offset = nextOffset + result.rows.length;
			onResult?.(result);
		} catch (e) {
			// without this a failed fetch left the spinner (or the "loading more" sentinel) up forever
			if (id === requestId) error = e;
		} finally {
			if (id === requestId) {
				loading = false;
				resetLoading = false;
			}
		}
	}

	return {
		get items() { return items; },
		set items(value: T[]) { items = value; },
		get total() { return total; },
		set total(value: number) { total = value; },
		get loading() { return loading; },
		get resetLoading() { return resetLoading; },
		get error() { return error; },
		reset: () => load(true),
		loadMore: () => load(false),
	};
}
