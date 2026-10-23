<script lang="ts">
	type Tone = 'neutral' | 'muted' | 'good' | 'bad' | 'gold';

	let { label, tone = 'neutral' }: { label: string; tone?: Tone } = $props();

	const TONE_CLASS: Record<Tone, string> = {
		neutral: 'bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/70',
		muted: 'bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50',
		good: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
		bad: 'bg-red-500/15 text-red-500',
		gold: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
	};
</script>

<span class={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]}`}>{label}</span>
